import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  BaseLocale,
  ImportTypeEnum,
} from '@/shared/entities/base_locale.entity';
import { Numero } from '@/shared/entities/numero.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { OvertureExtractService } from '@/shared/modules/overture/overture-extract.service';
import { OvertureTransformService } from '@/shared/modules/overture/overture-transform.service';
import { resolveRelease } from '@/shared/modules/overture/release';
import {
  OVERSIZED_SUBTYPES,
  OvertureDivision,
  RejectionReport,
  emptyRejectionReport,
} from '@/shared/modules/overture/overture.types';
import { localeForCountry } from '@/shared/modules/overture/utils/street-name.util';
import { territoryCodeFromDivision } from '@/shared/modules/territory/territory-code.util';
import { BaseLocaleService } from '@/modules/base_locale/base_locale.service';

import { optionalInt, requireString } from '../cli/args';

/** Above this many square degrees, an extract is almost certainly a mistake. */
const MAX_AREA_DEG2 = 50;

@Injectable()
export class ImportDivisionCommand {
  private readonly logger = new Logger(ImportDivisionCommand.name);

  constructor(
    private readonly extract: OvertureExtractService,
    private readonly transform: OvertureTransformService,
    private readonly baseLocaleService: BaseLocaleService,
    @InjectRepository(BaseLocale)
    private readonly balRepository: Repository<BaseLocale>,
    @InjectRepository(Voie)
    private readonly voieRepository: Repository<Voie>,
    @InjectRepository(Numero)
    private readonly numeroRepository: Repository<Numero>,
  ) {}

  async run(values: Record<string, unknown>): Promise<number> {
    const started = Date.now();
    const divisionId = requireString(values.division, 'division');
    const dryRun = values['dry-run'] === true;
    const force = values.force === true;

    const release = await resolveRelease(values.release as string);
    console.log(`Overture release: ${release}`);

    // 1. Resolve the territory.
    const division = await this.extract.getDivision(divisionId, release);
    if (!division) {
      console.error(
        `No division ${divisionId} in release ${release}.\n` +
          'Find one with: yarn overture:find --name "<text>"',
      );
      return 1;
    }
    this.printDivision(division);
    if (!this.checkSize(division, force)) return 1;

    // 2. Resolve the target BAL before doing expensive work, so a
    //    misconfiguration fails in seconds rather than after a long extract.
    const bal = dryRun
      ? null
      : await this.resolveTargetBal(values, division, force);
    if (!dryRun && !bal) return 1;

    // 3. Extract.
    const { filePath, count } = await this.extract.extractAddressesToFile({
      division,
      release,
      limit: optionalInt(values.limit, 'limit'),
    });
    console.log(`\n${count} address rows inside the division boundary.`);

    // 4. Transform, accumulating across batches.
    const locale = localeForCountry(division.country);
    const source = `overture-${release}`;
    const voies: Partial<Voie>[] = [];
    const numeros: Partial<Numero>[] = [];
    const rejected = emptyRejectionReport();

    for await (const batch of this.extract.readAddresses(filePath)) {
      const result = this.transform.addressesToBal(batch, { locale, source });
      voies.push(...result.payload.voies);
      numeros.push(...result.payload.numeros);
      for (const key of Object.keys(rejected) as (keyof RejectionReport)[]) {
        rejected[key] += result.rejected[key];
      }
    }

    // A street split across two batches would otherwise become two voies.
    const merged = this.mergeVoiesByName(voies, numeros);

    // 5. Optional streets fallback.
    const streetsThreshold = optionalInt(values['streets-if-below'], 'streets-if-below') ?? 100;
    const wantStreets = values.streets === true || count < streetsThreshold;
    if (wantStreets) {
      console.log('\nImporting named roads as METRIQUE voies…');
      const segments = await this.extract.extractSegments({ division, release });
      const result = this.transform.segmentsToBal(segments, { locale });
      merged.voies.push(...result.payload.voies);
      console.log(`${result.payload.voies.length} road(s) added.`);
    }

    this.printReport({
      division,
      release,
      scanned: count,
      voies: merged.voies.length,
      numeros: merged.numeros.length,
      rejected,
      durationMs: Date.now() - started,
    });

    if (dryRun) {
      console.log('\n--dry-run: nothing written.');
      return 0;
    }

    // 6. The seam: the same method the CSV and BAN imports use.
    console.log(`\nPopulating BAL ${bal.id}…`);
    await this.baseLocaleService.populate(bal, {
      voies: merged.voies,
      numeros: merged.numeros,
      toponymes: [],
    });

    await this.balRepository.update(
      { id: bal.id },
      {
        importType: ImportTypeEnum.OVERTURE,
        sourceDivisionId: division.id,
        // Only codes outside the French COG need it (see BaseLocale.communeNom),
        // but it is the same division either way.
        communeNom: division.name,
      },
    );

    console.log('Done.');
    console.log(`Editor: ${this.editorUrl(bal)}`);
    return 0;
  }

  /**
   * Voies are grouped per batch, so the same street appearing in two batches
   * yields two voie ids. Fold them together, repointing the numeros.
   */
  private mergeVoiesByName(
    voies: Partial<Voie>[],
    numeros: Partial<Numero>[],
  ): { voies: Partial<Voie>[]; numeros: Partial<Numero>[] } {
    const canonicalByNom = new Map<string, Partial<Voie>>();
    const remap = new Map<string, string>();

    for (const voie of voies) {
      const key = (voie.nom || '').toLocaleUpperCase();
      const existing = canonicalByNom.get(key);
      if (existing) {
        remap.set(voie.id, existing.id);
      } else {
        canonicalByNom.set(key, voie);
      }
    }

    if (remap.size > 0) {
      for (const numero of numeros) {
        const target = remap.get(numero.voieId);
        if (target) numero.voieId = target;
      }
    }

    return { voies: [...canonicalByNom.values()], numeros };
  }

  /** Refuse extracts whose bounding box would scan an implausible area. */
  private checkSize(division: OvertureDivision, force: boolean): boolean {
    const reasons: string[] = [];
    if (OVERSIZED_SUBTYPES.has(String(division.subtype))) {
      reasons.push(`subtype "${division.subtype}" covers a whole country or more`);
    }
    if (division.areaDeg2 > MAX_AREA_DEG2) {
      reasons.push(
        `bounding box is ${division.areaDeg2.toFixed(1)} deg² (limit ${MAX_AREA_DEG2})`,
      );
    }
    if (reasons.length === 0) return true;

    if (force) {
      console.warn(`\nWARNING: ${reasons.join('; ')}. Proceeding because --force.`);
      return true;
    }
    console.error(
      `\nRefusing to extract: ${reasons.join('; ')}.\n` +
        'This would scan a very large part of the Overture archive and could take hours.\n' +
        'Import a smaller division, or re-run with --force if you really mean it.',
    );
    return false;
  }

  private async resolveTargetBal(
    values: Record<string, unknown>,
    division: OvertureDivision,
    force: boolean,
  ): Promise<BaseLocale | null> {
    const balId = values.bal as string;
    const createBal = values['create-bal'] === true;

    if (!!balId === createBal) {
      console.error('Pass exactly one of --bal <id> or --create-bal.');
      return null;
    }

    if (createBal) {
      const email = requireString(values.email, 'email');
      const commune =
        (values.commune as string) || this.deriveTerritoryCode(division);
      const nom = (values.nom as string) || `Adresses de ${division.name}`;

      const country = (division.country || 'fr').toLowerCase();

      console.log(`\nCreating BAL "${nom}" (territory ${commune})…`);
      // The real service method, so the BAL is indistinguishable from one
      // created through the API — including its creation email.
      const created = await this.baseLocaleService.createOne({
        nom,
        emails: [email],
        commune,
        country,
      });
      console.log(`Created BAL ${created.id}`);
      return created;
    }

    const bal = await this.balRepository.findOneBy({ id: balId });
    if (!bal) {
      console.error(`No BAL ${balId}.`);
      return null;
    }

    // Guard against pointing a BAL at a different territory than it holds.
    if (bal.sourceDivisionId && bal.sourceDivisionId !== division.id) {
      const message =
        `BAL ${bal.id} was imported from division ${bal.sourceDivisionId}, ` +
        `not ${division.id}.`;
      if (!force) {
        console.error(`\n${message}\nRe-run with --force to replace it anyway.`);
        return null;
      }
      console.warn(`\nWARNING: ${message} Proceeding because --force.`);
    }

    // Populating deletes what is already there, which may include a clerk's
    // manual work — so say so explicitly rather than doing it quietly.
    const [voieCount, numeroCount] = await Promise.all([
      this.voieRepository.countBy({ balId: bal.id }),
      this.numeroRepository.countBy({ balId: bal.id }),
    ]);
    if (voieCount > 0 || numeroCount > 0) {
      const message =
        `BAL ${bal.id} already holds ${voieCount} voie(s) and ${numeroCount} numero(s), ` +
        'which this import will DELETE.';
      if (!force) {
        console.error(`\n${message}\nRe-run with --force to replace them.`);
        return null;
      }
      console.warn(`\nWARNING: ${message} Proceeding because --force.`);
    }

    return bal;
  }

  /** Default territory code for a --create-bal run. */
  private deriveTerritoryCode(division: OvertureDivision): string {
    return territoryCodeFromDivision(division.country, division.id);
  }

  private editorUrl(bal: BaseLocale): string {
    const pattern =
      process.env.EDITOR_URL_PATTERN ||
      'http://localhost:3000/bal/<id>/<token>';
    return pattern.replace('<id>', bal.id).replace('<token>', bal.token);
  }

  private printDivision(division: OvertureDivision): void {
    const where = [division.region, division.country].filter(Boolean).join(', ');
    console.log(
      `\nDivision: ${division.name} [${division.subtype}] ${where}\n` +
        `  id   ${division.id}\n` +
        `  bbox ${division.bbox.xmin},${division.bbox.ymin} → ` +
        `${division.bbox.xmax},${division.bbox.ymax}\n` +
        `  area ${division.areaDeg2.toFixed(4)} deg²`,
    );
  }

  private printReport(r: {
    division: OvertureDivision;
    release: string;
    scanned: number;
    voies: number;
    numeros: number;
    rejected: RejectionReport;
    durationMs: number;
  }): void {
    const skipped =
      r.rejected.empty +
      r.rejected.unparseable +
      r.rejected.outOfRange +
      r.rejected.duplicate;

    console.log(`
Import summary
  territory   ${r.division.name} (${r.division.id})
  release     ${r.release}
  scanned     ${r.scanned} address rows
  voies       ${r.voies}
  numeros     ${r.numeros}
  skipped     ${skipped}
    empty       ${r.rejected.empty}
    unparseable ${r.rejected.unparseable}   (no leading digits — e.g. "s/n")
    outOfRange  ${r.rejected.outOfRange}
    duplicate   ${r.rejected.duplicate}   (same number at same coordinates)
  elapsed     ${(r.durationMs / 1000).toFixed(1)}s`);
  }
}
