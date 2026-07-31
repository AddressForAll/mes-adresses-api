/**
 * Street-name handling for the Overture importer.
 *
 * Two distinct concerns, deliberately kept apart:
 *   - `streetKey`  — how we decide two rows belong to the same voie.
 *   - `electDisplayName` — which spelling we actually store.
 *
 * Conflating them (uppercase to group, then title-case to display) loses
 * information: Overture merges 175+ sources, so a street often appears with
 * several spellings and one of them is usually better than anything we could
 * synthesise.
 */

/** Map an ISO 3166-1 alpha-2 country to a locale for case operations. */
const COUNTRY_LOCALE: Record<string, string> = {
  FR: 'fr',
  BE: 'fr',
  BR: 'pt-BR',
  PT: 'pt',
  ES: 'es',
  IT: 'it',
  DE: 'de',
  TR: 'tr',
  AZ: 'az',
};

export function localeForCountry(country: string | null | undefined): string {
  if (!country) return 'en';
  return (
    process.env.OVERTURE_STREET_LOCALE ||
    COUNTRY_LOCALE[country.toUpperCase()] ||
    'en'
  );
}

/**
 * Grouping key: case- and diacritic-insensitive, whitespace- and
 * apostrophe-normalised. Diacritics are folded because the same street is
 * frequently published both with and without accents ("RUE DE L'EGLISE" vs
 * "Rue de l'Église") and those must land in one voie.
 */
export function streetKey(raw: string, locale = 'en'): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase(locale);
}

/**
 * Tokens that should not be naively title-cased. Roman numerals and ordinal
 * suffixes are common in street names and look wrong when capitalised.
 */
const ROMAN_NUMERAL = /^[IVXLCDM]+$/;
const ORDINAL = /^\d+(ST|ND|RD|TH|E|ER|ERE|EME|º|ª)$/i;

/**
 * Locale-aware title case that preserves accents and internal capitals.
 *
 * Only tokens that are ENTIRELY uppercase are touched — a source that already
 * mixed case ("McDonald", "O'Brien") is left exactly as it is. Capitalisation
 * restarts after -, ' and . so hyphenated and elided names come out right
 * ("SAINT-JEAN-DE-LUZ" -> "Saint-Jean-de-Luz").
 *
 * This cannot recover intercaps that the source destroyed: "MCDONALD" has no
 * information distinguishing it from "MACDONALD", so it becomes "Mcdonald".
 * That is precisely why electDisplayName prefers a real mixed-case variant
 * whenever the data offers one.
 */
export function smartTitleCase(input: string, locale = 'en'): string {
  const lower = (s: string) => s.toLocaleLowerCase(locale);
  const upper = (s: string) => s.toLocaleUpperCase(locale);

  // Words that stay lowercase inside a name (but never as the very first one).
  const MINOR: Record<string, Set<string>> = {
    fr: new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'aux', 'au', 'sur']),
    'pt-BR': new Set(['de', 'da', 'do', 'das', 'dos', 'e']),
    pt: new Set(['de', 'da', 'do', 'das', 'dos', 'e']),
    es: new Set(['de', 'del', 'la', 'las', 'los', 'y']),
    it: new Set(['di', 'del', 'della', 'dei', 'delle', 'e']),
    en: new Set<string>([]),
  };
  const minor = MINOR[locale] ?? MINOR.en;

  /** Capitalise the first letter, and any letter after ' or . inside a part. */
  const capitalise = (part: string) =>
    part.replace(
      /(^|['.’])(\p{L})/gu,
      (_m, sep: string, ch: string) => sep + upper(ch),
    );

  return input
    .split(/(\s+)/)
    .map((token, tokenIndex) => {
      if (token === '' || /^\s+$/.test(token)) return token;

      // Leave tokens alone unless they are fully uppercase: a source that
      // already cased them knows better than we do.
      if (token !== upper(token)) return token;
      if (token.length === 1) return token;
      if (ROMAN_NUMERAL.test(token)) return token;
      if (ORDINAL.test(token)) return lower(token);

      const isFirstToken = tokenIndex === 0;

      // Hyphenated compounds are handled part by part, so minor words inside
      // them stay lowercase too: "SAINT-JEAN-DE-LUZ" -> "Saint-Jean-de-Luz".
      return lower(token)
        .split('-')
        .map((part, partIndex) => {
          const isVeryFirst = isFirstToken && partIndex === 0;
          if (!isVeryFirst && minor.has(part)) return part;
          return capitalise(part);
        })
        .join('-');
    })
    .join('');
}

/**
 * Minimum share of a street's rows a mixed-case spelling must hold before we
 * trust it over title-casing the majority spelling.
 *
 * Calibrated against real Fresno County data, where all four multi-spelling
 * streets are informative:
 *   McCLAIN ST (24) vs MCCLAIN ST (16)      -> 60%, a genuine better spelling
 *   Dinkey Creek Rd (4) vs DINKEY... (33)   -> 11%, title-casing agrees anyway
 *   14th AVE (4) vs 14TH AVE (98)           ->  4%, title-casing is better
 *   S OLIViA AVE (1) vs S OLIVIA AVE (14)   ->  7%, a TYPO that must not win
 * A 30% floor keeps McCLAIN and rejects the typo.
 */
const MIXED_CASE_MIN_SHARE = 0.3;

/**
 * Choose the spelling to store for a voie, given every spelling observed for it
 * and how often each occurred.
 *
 * Preference order:
 *   1. the most frequent mixed-case spelling, if it holds >= 30% of the rows
 *   2. otherwise, the most frequent spelling, title-cased if it is all-caps
 */
export function electDisplayName(
  variants: Map<string, number>,
  locale = 'en',
): string {
  if (variants.size === 0) return '';

  let total = 0;
  let best: { name: string; count: number } | null = null;
  let bestMixed: { name: string; count: number } | null = null;

  for (const [name, count] of variants) {
    total += count;
    // Ties break on the longer spelling, which keeps "Avenue" over "Ave".
    const beats = (a: { name: string; count: number } | null) =>
      !a || count > a.count || (count === a.count && name.length > a.name.length);

    if (beats(best)) best = { name, count };
    if (name !== name.toLocaleUpperCase(locale) && beats(bestMixed)) {
      bestMixed = { name, count };
    }
  }

  if (bestMixed && bestMixed.count / total >= MIXED_CASE_MIN_SHARE) {
    return bestMixed.name.trim();
  }
  return smartTitleCase(best.name.trim(), locale);
}
