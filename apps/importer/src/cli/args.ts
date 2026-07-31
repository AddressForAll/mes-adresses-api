import { parseArgs } from 'node:util';

/**
 * CLI parsing with node's built-in `parseArgs` rather than a framework.
 *
 * Engines are pinned to node 24, where parseArgs is stable core API. Two
 * commands with a handful of flags do not justify a new dependency carrying a
 * @nestjs/common peer range — in a fork whose main long-term cost is merge
 * conflicts with upstream, every avoidable dependency is worth avoiding.
 */
const OPTIONS = {
  // shared
  release: { type: 'string' },
  limit: { type: 'string' },
  help: { type: 'boolean', default: false },
  // find
  name: { type: 'string' },
  country: { type: 'string' },
  subtype: { type: 'string' },
  // import
  division: { type: 'string' },
  bal: { type: 'string' },
  'create-bal': { type: 'boolean', default: false },
  commune: { type: 'string' },
  nom: { type: 'string' },
  email: { type: 'string' },
  streets: { type: 'boolean', default: false },
  'streets-if-below': { type: 'string', default: '100' },
  'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
} as const;

export type RawArgs = ReturnType<typeof parseCli>['values'];

export function parseCli(argv: string[] = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS as never,
    allowPositionals: true,
    strict: true,
  });
  return { command: positionals[0], values: values as Record<string, unknown> };
}

export const USAGE = `
Overture Maps importer — populates a Base Adresse Locale from Overture data.

A territory is identified by its Overture division (GERS) id, which exists
worldwide at every administrative level, so the same two commands work for a
US county, a French commune or a Brazilian município.

USAGE
  yarn overture:find   --name <text> [--country XX] [--subtype <subtype>] [--limit N]
  yarn overture:import --division <gers-id> (--bal <bal-id> | --create-bal --email <addr>)

COMMANDS
  find     Search divisions by name and print their GERS ids.
  import   Extract a division's addresses and populate a BAL with them.

FIND OPTIONS
  --name <text>        Substring of the division name (required).
  --country <XX>       ISO 3166-1 alpha-2 filter, e.g. US, FR, BR.
  --subtype <subtype>  country|region|county|localadmin|locality|neighborhood|…
  --limit N            Max rows to print (default 25).

IMPORT OPTIONS
  --division <uuid>    Overture division id to import (required).
  --bal <id>           Populate this existing BAL.
  --create-bal         Create a new BAL instead; requires --email.
  --email <addr>       Owner email for --create-bal (receives the edit link).
  --commune <code>     Territory code for --create-bal (default: derived from
                       the division id). Must satisfy COUNTRY_PROFILE.
  --nom <text>         BAL name for --create-bal (default: "Adresses de <name>").
  --streets            Also import named roads as METRIQUE voies.
  --streets-if-below N Import roads automatically when fewer than N addresses
                       were found (default 100). Use 0 to disable.
  --limit N            Cap the number of address rows (for smoke tests).
  --dry-run            Extract and report, but do not write to the database.
  --force              Override the size guard, the territory-mismatch guard,
                       and the confirmation for replacing a non-empty BAL.

COMMON OPTIONS
  --release <id>       Overture release, e.g. 2026-07-22.0 (default: latest).
  --help               Show this message.

NOTES
  Importing replaces the BAL's existing voies, numeros and toponymes.
  House numbers must start with digits; systems that do not (Japanese block
  addressing, Spanish "s/n") are reported as unparseable, because BAL stores
  numero as an integer.

EXAMPLES
  yarn overture:find --name "Fresno" --country US --subtype county
  yarn overture:import --division 197cfe35-… --create-bal --email me@example.org
  yarn overture:import --division 197cfe35-… --bal 65f… --limit 2000 --dry-run
`;

/** Parse a flag that should be a positive integer, or undefined if absent. */
export function optionalInt(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${label} must be a non-negative integer, got "${value}"`);
  }
  return n;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`--${label} is required`);
  }
  return value.trim();
}
