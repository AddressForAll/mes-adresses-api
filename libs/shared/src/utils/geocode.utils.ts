/**
 * AFA.codes geocode attached to an address point.
 *
 * The format is only partly known: Brazilian codes seen so far are 8
 * uppercase alphanumerics shown as `XXXXX-XXX`, optionally behind a `BR-`
 * presentation prefix, and other countries are expected to have their own
 * lengths and groupings. So storage is deliberately loose: the bare code,
 * uppercased, without separators, 1 to GEOCODE_MAX_LENGTH letters or digits.
 * Country-specific presentation belongs to the frontend.
 */
export const GEOCODE_MAX_LENGTH = 16;

export const GEOCODE_PATTERN = new RegExp(
  `^[0-9A-Z]{1,${GEOCODE_MAX_LENGTH}}$`,
);

const SEPARATORS = /[\s\-_.]/g;

/**
 * Canonical stored form of a typed geocode: uppercase, separators removed.
 * When `countryPrefix` is given (e.g. `BR`), a leading `BR-` / `BR ` is
 * dropped as presentation. An unseparated `BR...` is kept, since a code may
 * itself start with those letters. Empty input becomes null.
 */
export function normalizeGeocode(
  value: string | null | undefined,
  countryPrefix?: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  let code = value.trim().toUpperCase();
  if (countryPrefix) {
    const prefix = countryPrefix.toUpperCase();
    const withSeparator = new RegExp(`^${prefix}[\\s\\-_.:]+`);
    code = code.replace(withSeparator, '');
  }
  code = code.replace(SEPARATORS, '');
  return code === '' ? null : code;
}

export function isValidGeocode(code: string): boolean {
  return GEOCODE_PATTERN.test(code);
}

/** Free-text property registration (Brazilian *inscrição imobiliária*). */
export const INSCRICAO_IMOBILIARIA_MAX_LENGTH = 64;

/** Trims only: leading zeros and inner formatting are significant. */
export function normalizeInscricaoImobiliaria(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * ISO country prefix of a non-French territory code (`BR-4b92ca07` → `BR`),
 * or undefined for a French INSEE code.
 */
export function territoryCountryPrefix(
  territoryCode: string | null | undefined,
): string | undefined {
  return territoryCode?.match(/^([A-Z]{2})-/)?.[1];
}
