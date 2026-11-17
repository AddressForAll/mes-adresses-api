import {
  isValidGeocode,
  normalizeGeocode,
  normalizeInscricaoImobiliaria,
  territoryCountryPrefix,
} from './geocode.utils';

describe('normalizeGeocode', () => {
  it.each([
    ['R7FGJ-2Z2', 'R7FGJ2Z2'],
    ['r7fgj2z2', 'R7FGJ2Z2'],
    [' R7FGJ 2Z2 ', 'R7FGJ2Z2'],
    ['R7FGJ.2Z2', 'R7FGJ2Z2'],
  ])('stores %p as %p', (input, expected) => {
    expect(normalizeGeocode(input)).toBe(expected);
  });

  it('drops a separated country prefix when the country is known', () => {
    expect(normalizeGeocode('BR-R7FGJ-2Z2', 'BR')).toBe('R7FGJ2Z2');
    expect(normalizeGeocode('br r7fgj-2z2', 'BR')).toBe('R7FGJ2Z2');
  });

  it('keeps an unseparated leading BR, which may be part of the code', () => {
    expect(normalizeGeocode('BRR7FGJ2', 'BR')).toBe('BRR7FGJ2');
  });

  it('leaves another country prefix alone', () => {
    expect(normalizeGeocode('US-R7FGJ-2Z2', 'BR')).toBe('USR7FGJ2Z2');
  });

  it('turns empty input into null', () => {
    expect(normalizeGeocode('')).toBeNull();
    expect(normalizeGeocode(' - ')).toBeNull();
    expect(normalizeGeocode(null)).toBeNull();
    expect(normalizeGeocode(undefined)).toBeNull();
  });
});

describe('isValidGeocode', () => {
  it('accepts any letters and digits up to 16 characters', () => {
    expect(isValidGeocode('R7FGJ2Z2')).toBe(true);
    expect(isValidGeocode('AIOUL0')).toBe(true);
    expect(isValidGeocode('A')).toBe(true);
    expect(isValidGeocode('0123456789ABCDEF')).toBe(true);
  });

  it('rejects other characters and overlong codes', () => {
    expect(isValidGeocode('R7FGJ-2Z2')).toBe(false);
    expect(isValidGeocode('r7fgj2z2')).toBe(false);
    expect(isValidGeocode('R7FGJ2Z2!')).toBe(false);
    expect(isValidGeocode('0123456789ABCDEFG')).toBe(false);
    expect(isValidGeocode('')).toBe(false);
  });
});

describe('normalizeInscricaoImobiliaria', () => {
  it('only trims, keeping leading zeros and inner formatting', () => {
    expect(normalizeInscricaoImobiliaria(' 00012.345-6 ')).toBe('00012.345-6');
    expect(normalizeInscricaoImobiliaria('')).toBeNull();
    expect(normalizeInscricaoImobiliaria(null)).toBeNull();
  });
});

describe('territoryCountryPrefix', () => {
  it('reads the ISO prefix of a non-French territory code', () => {
    expect(territoryCountryPrefix('BR-4b92ca07')).toBe('BR');
    expect(territoryCountryPrefix('US-197cfe35')).toBe('US');
  });

  it('returns undefined for a French INSEE code', () => {
    expect(territoryCountryPrefix('91400')).toBeUndefined();
    expect(territoryCountryPrefix('2A004')).toBeUndefined();
    expect(territoryCountryPrefix(null)).toBeUndefined();
  });
});
