/**
 * Deterministic opaque territory code for an Overture division: country plus
 * the first 8 hex digits of the division (area) id, e.g. `US-197cfe35` for
 * Fresno County. Stable across re-runs, and within the 16 chars
 * `bases_locales.commune` allows.
 *
 * Shared by the importer (`--create-bal`) and the editor's territory
 * selectors, so a territory created either way gets the same code — which is
 * what lets the "a BAL already exists for this territory" check find BALs the
 * CLI created.
 */
export function territoryCodeFromDivision(
  country: string | null | undefined,
  divisionId: string,
): string {
  const prefix = (country || 'XX').toUpperCase();
  return `${prefix}-${divisionId.replace(/-/g, '').slice(0, 8)}`;
}
