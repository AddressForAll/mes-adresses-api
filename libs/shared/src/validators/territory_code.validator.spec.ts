import {
  isTerritoryCode,
  resetCountryProfileCache,
} from './territory_code.validator';

describe('isTerritoryCode', () => {
  const original = process.env.COUNTRY_PROFILE;

  afterEach(() => {
    process.env.COUNTRY_PROFILE = original;
    resetCountryProfileCache();
  });

  it('only accepts French COG codes under the default profile', () => {
    delete process.env.COUNTRY_PROFILE;
    resetCountryProfileCache();

    expect(isTerritoryCode('38339')).toBe(true);
    expect(isTerritoryCode('US-197cfe35')).toBe(false);
  });

  it('accepts catalog territory codes and French codes under generic', () => {
    process.env.COUNTRY_PROFILE = 'generic';
    resetCountryProfileCache();

    expect(isTerritoryCode('US-197cfe35')).toBe(true);
    expect(isTerritoryCode('38339')).toBe(true);
    expect(isTerritoryCode('US 197')).toBe(false);
    expect(isTerritoryCode(['US-197cfe35'])).toBe(false);
  });
});
