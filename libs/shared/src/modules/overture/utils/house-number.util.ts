/**
 * Country-agnostic house-number parsing.
 *
 * BAL splits an address number into `numero` (a non-negative integer) and an
 * optional free-text `suffixe`. Overture's `number` field is a single string
 * whose shape varies by source and country, so this is where the two meet.
 */

/** 99999 is reserved by the BAL spec for toponyme-only addresses. */
export const MAX_NUMERO = 99998;

/** Why a raw value could not become a numero. Doubles as a RejectionReport key. */
export type HouseNumberRejection = 'empty' | 'unparseable' | 'outOfRange';

/**
 * Discriminated on a STRING, not a boolean: this repo compiles with
 * `strictNullChecks: false`, under which TypeScript does not narrow a union by
 * a boolean literal property (verified — a `{ok: true} | {ok: false}` union
 * fails to narrow), but does narrow correctly on string literals.
 */
export type ParsedHouseNumber =
  | { status: 'ok'; numero: number; suffixe: string | null }
  | { status: HouseNumberRejection };

/**
 * Unicode dash variants seen in address data (hyphen, non-breaking hyphen,
 * figure/en/em dash, minus sign, fullwidth hyphen). Normalised to ASCII '-' so
 * downstream comparisons and the separator strip below behave predictably.
 */
const DASH_VARIANTS = /[‐-―−－]/g;

/** Separators between the number and its suffix, stripped from the suffix. */
const LEADING_SEPARATORS = /^[\s\-/.,·]+/u;

/**
 * Parse an Overture house number into BAL's (numero, suffixe) pair.
 *
 * Examples:
 *   "123"      -> { numero: 123, suffixe: null }
 *   "123A"     -> { numero: 123, suffixe: "A" }
 *   "5 bis"    -> { numero: 5,   suffixe: "bis" }
 *   "12-14"    -> { numero: 12,  suffixe: "14" }
 *   "7 1/2"    -> { numero: 7,   suffixe: "1/2" }
 *   "622 624"  -> { numero: 622, suffixe: "624" }
 *   "s/n"      -> unparseable
 *
 * The suffix keeps its source casing; `numeroService.importMany` applies
 * `normalizeSuffixe` (lowercase+trim) when persisting, so lowercasing here
 * would just hide where that responsibility lives.
 *
 * Known limitation: addressing systems whose primary component is not a leading
 * integer — Japanese block addressing, Spanish "s/n" (sin número), Irish
 * no-number rural addresses — cannot be represented, because `numeros.numero`
 * is `int NOT NULL`. Those rows are reported as `unparseable` rather than
 * silently dropped.
 */
export function parseHouseNumber(raw: string | null | undefined): ParsedHouseNumber {
  if (raw === null || raw === undefined) {
    return { status: 'empty' };
  }

  const normalized = String(raw)
    .normalize('NFC')
    .replace(DASH_VARIANTS, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return { status: 'empty' };
  }

  // Bounded digit run: an absurdly long numeric field must not parse to
  // Infinity or silently overflow.
  const match = normalized.match(/^(\d{1,6})(.*)$/u);
  if (!match) {
    return { status: 'unparseable' };
  }

  const numero = Number.parseInt(match[1], 10);
  if (!Number.isInteger(numero) || numero < 0 || numero > MAX_NUMERO) {
    return { status: 'outOfRange' };
  }

  // Strip the separator so BAL's own display logic re-applies its convention:
  // keeping "-14" from "12-14" would render as "12 --14".
  const suffixe = match[2].replace(LEADING_SEPARATORS, '').trim();

  return { status: 'ok', numero, suffixe: suffixe || null };
}
