import {
  electDisplayName,
  localeForCountry,
  smartTitleCase,
  streetKey,
} from './street-name.util';

describe('streetKey', () => {
  it('folds case', () => {
    expect(streetKey('Main Street')).toBe(streetKey('MAIN STREET'));
  });

  it('folds diacritics so accented and unaccented sources merge', () => {
    // Overture merges 175+ sources; the same street commonly appears both ways.
    expect(streetKey("Rue de l'Église", 'fr')).toBe(
      streetKey("RUE DE L'EGLISE", 'fr'),
    );
  });

  it('normalises curly apostrophes', () => {
    expect(streetKey('Rue de l’Église', 'fr')).toBe(
      streetKey("Rue de l'Eglise", 'fr'),
    );
  });

  it('collapses whitespace', () => {
    expect(streetKey('  N   BLACKSTONE   AVE ')).toBe(
      streetKey('N BLACKSTONE AVE'),
    );
  });

  it('keeps genuinely different streets apart', () => {
    expect(streetKey('N Blackstone Ave')).not.toBe(
      streetKey('S Blackstone Ave'),
    );
  });
});

describe('smartTitleCase', () => {
  it('title-cases an all-caps name', () => {
    expect(smartTitleCase('N BLACKSTONE AVE')).toBe('N Blackstone Ave');
  });

  it('leaves an already mixed-case token untouched', () => {
    // A source that cased it knows better than we do.
    expect(smartTitleCase('McDonald Ave')).toBe('McDonald Ave');
    expect(smartTitleCase("O'Brien St")).toBe("O'Brien St");
  });

  it('capitalises after hyphens', () => {
    expect(smartTitleCase('SAINT-JEAN-DE-LUZ', 'fr')).toBe('Saint-Jean-de-Luz');
  });

  it('capitalises after an apostrophe', () => {
    expect(smartTitleCase("L'EGLISE", 'fr')).toBe("L'Eglise");
  });

  it('preserves accents present in the source', () => {
    expect(smartTitleCase('RUE DU GÉNÉRAL LECLERC', 'fr')).toBe(
      'Rue du Général Leclerc',
    );
  });

  it('keeps French particles lowercase, but not as the first word', () => {
    expect(smartTitleCase('DE LA TOUR', 'fr')).toBe('De la Tour');
  });

  it('keeps Portuguese particles lowercase', () => {
    expect(smartTitleCase('RUA DA CONSOLACAO', 'pt-BR')).toBe(
      'Rua da Consolacao',
    );
  });

  it('lowercases ordinal suffixes', () => {
    expect(smartTitleCase('14TH AVE')).toBe('14th Ave');
  });

  it('leaves roman numerals uppercase', () => {
    expect(smartTitleCase('RUE HENRI IV', 'fr')).toBe('Rue Henri IV');
  });

  it('uses locale-aware casing for Turkish dotted I', () => {
    // Turkish pairs İ/i and I/ı. Lowercasing "İSTİKLAL" must yield "istiklal"
    // (not "i̇stanbul" with a combining dot, which is what the en locale gives),
    // and re-capitalising must restore the dotted İ.
    expect(smartTitleCase('İSTİKLAL CADDESİ', 'tr')).toBe('İstiklal Caddesi');
  });

  it('does not invent information the source destroyed', () => {
    // "ISTIKLAL" written without dots is genuinely ambiguous in Turkish, so we
    // apply tr casing rules faithfully rather than guessing the dotted form.
    expect(smartTitleCase('ISTIKLAL', 'tr')).toBe('Istıklal');
  });
});

describe('electDisplayName', () => {
  const variants = (entries: [string, number][]) => new Map(entries);

  it('title-cases when every variant is all-caps', () => {
    expect(electDisplayName(variants([['N BLACKSTONE AVE', 120]]))).toBe(
      'N Blackstone Ave',
    );
  });

  it('prefers a well-represented mixed-case spelling over title-casing', () => {
    // Real Fresno data: McCLAIN ST (24) vs MCCLAIN ST (16) -> 60% share.
    // Title-casing the majority would give "Mcclain St", losing the capital C.
    expect(
      electDisplayName(
        variants([
          ['MCCLAIN ST', 16],
          ['McCLAIN ST', 24],
        ]),
      ),
    ).toBe('McCLAIN ST');
  });

  it('rejects a rare mixed-case spelling that is really a typo', () => {
    // Real Fresno data: S OLIViA AVE appears once against 14 correct rows.
    expect(
      electDisplayName(
        variants([
          ['S OLIVIA AVE', 14],
          ['S OLIViA AVE', 1],
        ]),
      ),
    ).toBe('S Olivia Ave');
  });

  it('ignores a rare mixed-case variant when title-casing is better', () => {
    // Real Fresno data: 14th AVE (4) vs 14TH AVE (98) -> 4% share.
    expect(
      electDisplayName(
        variants([
          ['14TH AVE', 98],
          ['14th AVE', 4],
        ]),
      ),
    ).toBe('14th Ave');
  });

  it('picks the good spelling when sources disagree on accents', () => {
    expect(
      electDisplayName(
        variants([
          ['RUE DU GENERAL LECLERC', 10],
          ['Rue du Général Leclerc', 10],
        ]),
        'fr',
      ),
    ).toBe('Rue du Général Leclerc');
  });

  it('breaks frequency ties on the longer spelling', () => {
    // Keeps "Avenue" rather than the abbreviated "Ave".
    expect(
      electDisplayName(
        variants([
          ['Main Ave', 5],
          ['Main Avenue', 5],
        ]),
      ),
    ).toBe('Main Avenue');
  });

  it('returns an empty string for no variants', () => {
    expect(electDisplayName(new Map())).toBe('');
  });
});

describe('localeForCountry', () => {
  afterEach(() => {
    delete process.env.OVERTURE_STREET_LOCALE;
  });

  it.each([
    ['US', 'en'],
    ['FR', 'fr'],
    ['BR', 'pt-BR'],
    ['TR', 'tr'],
  ])('maps %s to %s', (country, locale) => {
    expect(localeForCountry(country)).toBe(locale);
  });

  it('defaults to en for an unknown or missing country', () => {
    expect(localeForCountry('ZZ')).toBe('en');
    expect(localeForCountry(null)).toBe('en');
  });

  it('honours an explicit override', () => {
    process.env.OVERTURE_STREET_LOCALE = 'es';
    expect(localeForCountry('US')).toBe('es');
  });
});
