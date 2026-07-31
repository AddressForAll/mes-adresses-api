import { Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { v4 as uuid } from 'uuid';

import { Voie, TypeNumerotationEnum } from '@/shared/entities/voie.entity';
import { Numero } from '@/shared/entities/numero.entity';
import { PositionTypeEnum } from '@/shared/entities/position.entity';

import {
  OvertureAddressRow,
  OvertureSegmentRow,
  RejectionReport,
  emptyRejectionReport,
} from './overture.types';
import { parseHouseNumber } from './utils/house-number.util';
import { electDisplayName, streetKey } from './utils/street-name.util';

export type TransformPayload = {
  voies: Partial<Voie>[];
  numeros: Partial<Numero>[];
  toponymes: Partial<never>[];
};

export type TransformResult = {
  payload: TransformPayload;
  rejected: RejectionReport;
};

export type TransformOptions = {
  /** Locale used for case-folding and title-casing street names. */
  locale?: string;
  /** Value stored on each position's `source`, e.g. "overture-2026-07-22.0". */
  source: string;
};

/**
 * Turns Overture rows into the entity shape `BaseLocaleService.populate()`
 * consumes.
 *
 * Deliberately pure and synchronous: no database, no network, no Overture SQL.
 * That keeps the part most likely to be wrong for a country we have not tried
 * yet — name casing, number parsing, deduplication — unit-testable against a
 * fixture with zero infrastructure.
 *
 * Ids are generated here rather than by the database because the bulk INSERT
 * needs `numero.voieId` to reference a voie that does not exist yet.
 */
@Injectable()
export class OvertureTransformService {
  /**
   * Address points -> NUMERIQUE voies + numeros (one position each).
   *
   * No toponymes are produced: Overture addresses carry no notion of a
   * lieu-dit, and inventing one from `postal_city` would fabricate data.
   */
  addressesToBal(
    rows: OvertureAddressRow[],
    { locale = 'en', source }: TransformOptions,
  ): TransformResult {
    const rejected = emptyRejectionReport();

    type Group = {
      voieId: string;
      banId: string;
      /** spelling -> occurrences, for electDisplayName */
      variants: Map<string, number>;
      numeros: Partial<Numero>[];
      /** numero|suffixe|lon,lat already emitted, for intra-street dedup */
      seen: Set<string>;
    };
    const groups = new Map<string, Group>();

    for (const row of rows) {
      const street = (row.street ?? '').trim();
      if (!street) {
        rejected.empty++;
        continue;
      }

      const key = streetKey(street, locale);
      let group = groups.get(key);
      if (!group) {
        group = {
          voieId: new ObjectId().toHexString(),
          banId: uuid(),
          variants: new Map(),
          numeros: [],
          seen: new Set(),
        };
        groups.set(key, group);
      }
      group.variants.set(street, (group.variants.get(street) ?? 0) + 1);

      const parsed = parseHouseNumber(row.number);
      if (parsed.status !== 'ok') {
        rejected[parsed.status]++;
        continue;
      }

      // Overture merges many sources, so the same physical address commonly
      // arrives more than once at near-identical coordinates. Without this the
      // editor shows visibly stacked pins.
      const dedupKey = `${parsed.numero}|${parsed.suffixe ?? ''}|${row.lon.toFixed(6)},${row.lat.toFixed(6)}`;
      if (group.seen.has(dedupKey)) {
        rejected.duplicate++;
        continue;
      }
      group.seen.add(dedupKey);

      group.numeros.push({
        id: new ObjectId().toHexString(),
        banId: uuid(),
        voieId: group.voieId,
        numero: parsed.numero,
        suffixe: parsed.suffixe,
        parcelles: [],
        // Overture data is third-party; only a local authority can certify.
        certifie: false,
        communeDeleguee: null,
        gersId: row.gersId || null,
        positions: [
          {
            // NB: PositionTypeEnum's stored values are French strings
            // ('entrée', 'bâtiment', …) — a Postgres enum inherited from
            // upstream, not something this importer introduces.
            type: PositionTypeEnum.ENTREE,
            source,
            rank: 0,
            point: {
              type: 'Point',
              coordinates: [row.lon, row.lat],
            },
          },
        ],
      } as Partial<Numero>);
    }

    const voies: Partial<Voie>[] = [];
    const numeros: Partial<Numero>[] = [];

    for (const group of groups.values()) {
      // A street whose every number failed to parse would otherwise become a
      // voie with no addresses — a phantom entry for the clerk to puzzle over.
      if (group.numeros.length === 0) continue;

      voies.push({
        id: group.voieId,
        banId: group.banId,
        nom: electDisplayName(group.variants, locale),
        typeNumerotation: TypeNumerotationEnum.NUMERIQUE,
      });
      numeros.push(...group.numeros);
    }

    return { payload: { voies, numeros, toponymes: [] }, rejected };
  }

  /**
   * Named road segments -> METRIQUE voies carrying a trace, with no numeros.
   *
   * Used as a fallback where address coverage is thin, so the editor opens with
   * streets to hang numbers off rather than an empty map. Deduplication by name
   * happens in SQL (see OvertureExtractService.extractSegments), because
   * Overture splits a single street into many segments.
   */
  segmentsToBal(
    rows: OvertureSegmentRow[],
    { locale = 'en' }: Pick<TransformOptions, 'locale'> = {},
  ): TransformResult {
    const rejected = emptyRejectionReport();
    const voies: Partial<Voie>[] = [];

    for (const row of rows) {
      const name = (row.name ?? '').trim();
      if (!name) {
        rejected.empty++;
        continue;
      }
      // A trace needs at least two vertices to be a LineString.
      if (!row.geometry?.coordinates || row.geometry.coordinates.length < 2) {
        rejected.unparseable++;
        continue;
      }

      voies.push({
        id: new ObjectId().toHexString(),
        banId: uuid(),
        // Single spelling per row here (SQL already grouped by name), so this
        // is really just "title-case it if it is all-caps".
        nom: electDisplayName(new Map([[name, 1]]), locale),
        typeNumerotation: TypeNumerotationEnum.METRIQUE,
        trace: row.geometry,
        gersId: row.gersId || null,
      });
    }

    return { payload: { voies, numeros: [], toponymes: [] }, rejected };
  }
}
