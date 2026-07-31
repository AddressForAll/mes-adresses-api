import { Injectable } from '@nestjs/common';

import { OvertureExtractService } from '@/shared/modules/overture/overture-extract.service';
import { resolveRelease } from '@/shared/modules/overture/release';

import { optionalInt, requireString } from '../cli/args';

/**
 * `overture:find` — search Overture divisions by name so an engineer can get
 * the GERS id needed by `overture:import`.
 */
@Injectable()
export class FindDivisionsCommand {
  constructor(private readonly extract: OvertureExtractService) {}

  async run(values: Record<string, unknown>): Promise<number> {
    const name = requireString(values.name, 'name');
    const release = await resolveRelease(values.release as string);

    console.log(`Overture release: ${release}`);
    console.log('Scanning divisions (this takes a while — no index on names)…\n');

    const divisions = await this.extract.findDivisions({
      name,
      release,
      country: values.country as string,
      subtype: values.subtype as string,
      limit: optionalInt(values.limit, 'limit') || 25,
    });

    if (divisions.length === 0) {
      console.log('No divisions matched.');
      console.log('Try a shorter --name, or drop --country / --subtype.');
      return 1;
    }

    for (const [i, d] of divisions.entries()) {
      const where = [d.region, d.country].filter(Boolean).join(', ');
      console.log(
        `${String(i + 1).padStart(2)}. ${d.name}  [${d.subtype}]  ${where}`,
      );
      console.log(`    id   ${d.id}`);
      console.log(`    area ${d.areaDeg2.toFixed(4)} deg²`);
      console.log(`    → yarn overture:import --division ${d.id} --bal <bal-id>`);
      console.log('');
    }

    console.log(
      `${divisions.length} division(s). Pick the one at the administrative level you want:\n` +
        'importing a county gives every address in it, including its towns.',
    );
    return 0;
  }
}
