import { PointValidator } from './coord.validator';
import { resetCountryProfileCache } from './territory_code.validator';

const point = (coordinates: unknown[]) =>
  ({ type: 'Point', coordinates }) as any;

const PARIS = [2.35, 48.85];
const FRESNO = [-119.689, 36.6275];
const SAO_PAULO = [-46.63, -23.55];

describe('PointValidator', () => {
  const validator = new PointValidator();
  const originalProfile = process.env.COUNTRY_PROFILE;

  const withProfile = (profile: string | undefined) => {
    if (profile === undefined) {
      delete process.env.COUNTRY_PROFILE;
    } else {
      process.env.COUNTRY_PROFILE = profile;
    }
    resetCountryProfileCache();
  };

  afterAll(() => withProfile(originalProfile));

  describe('default (fr) profile — upstream behaviour', () => {
    beforeEach(() => withProfile(undefined));

    it('accepts a point in France', async () => {
      expect(await validator.validate(point(PARIS))).toBe(true);
    });

    it('rejects points outside French territory', async () => {
      expect(await validator.validate(point(FRESNO))).toBe(false);
      expect(await validator.validate(point(SAO_PAULO))).toBe(false);
    });
  });

  describe('generic profile', () => {
    beforeEach(() => withProfile('generic'));

    it('accepts points anywhere in the world', async () => {
      expect(await validator.validate(point(PARIS))).toBe(true);
      expect(await validator.validate(point(FRESNO))).toBe(true);
      expect(await validator.validate(point(SAO_PAULO))).toBe(true);
      expect(await validator.validate(point([180, -90]))).toBe(true);
    });

    it('rejects coordinates outside WGS84 bounds', async () => {
      expect(await validator.validate(point([-119.689, 91]))).toBe(false);
      expect(await validator.validate(point([181, 36.6]))).toBe(false);
      // Swapped lat/lon is only catchable when it leaves the valid range.
      expect(await validator.validate(point([36.6, -119.689]))).toBe(false);
    });

    it('rejects malformed coordinates', async () => {
      expect(await validator.validate(point([NaN, 36.6]))).toBe(false);
      expect(await validator.validate(point([Infinity, 36.6]))).toBe(false);
      expect(await validator.validate(point(['-119.6', '36.6']))).toBe(false);
      expect(await validator.validate(point([-119.6]))).toBe(false);
      expect(await validator.validate(point([-119.6, 36.6, 10]))).toBe(false);
    });
  });
});
