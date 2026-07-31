import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ValidatorCogCommune } from './cog.validator';

export enum CountryProfileEnum {
  /** Upstream behaviour: codes must exist in the French COG. */
  FR = 'fr',
  /** Any well-formed opaque territory code (US FIPS, IBGE, Overture-derived…). */
  GENERIC = 'generic',
}

/**
 * Read straight from process.env rather than ConfigService: class-validator
 * instantiates @Validate() constraint classes outside Nest's DI container
 * (`useContainer()` is never called in this app), so injection is unavailable
 * here. Memoised so the env lookup happens once.
 */
let cachedProfile: CountryProfileEnum | undefined;

export function getCountryProfile(): CountryProfileEnum {
  if (cachedProfile) {
    return cachedProfile;
  }
  const raw = (
    process.env.COUNTRY_PROFILE || CountryProfileEnum.FR
  ).toLowerCase();
  cachedProfile = Object.values(CountryProfileEnum).includes(
    raw as CountryProfileEnum,
  )
    ? (raw as CountryProfileEnum)
    : // An unrecognised profile falls back to upstream behaviour rather than
      // silently accepting anything.
      CountryProfileEnum.FR;
  return cachedProfile;
}

/** Test-only: forget the memoised profile so a test can switch COUNTRY_PROFILE. */
export function resetCountryProfileCache(): void {
  cachedProfile = undefined;
}

/**
 * Opaque territory code: 2–16 chars of [A-Za-z0-9] plus `-` and `_`.
 * Deliberately excludes spaces, slashes and dots so codes stay URL-safe and
 * safe to embed in the BAL CSV's `cle_interop` without quoting.
 */
const GENERIC_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,15}$/;

/**
 * Validates a territory code according to the configured country profile.
 *
 * This replaces the hardcoded French-COG check at every `commune` /
 * `commune_deleguee` call site. Under the default `fr` profile it delegates to
 * ValidatorCogCommune, so an untouched checkout behaves exactly like upstream;
 * only deployments that opt into COUNTRY_PROFILE=generic accept foreign codes.
 */
@ValidatorConstraint({ name: 'validatorTerritoryCode' })
export class ValidatorTerritoryCode implements ValidatorConstraintInterface {
  private readonly cog = new ValidatorCogCommune();

  validate(value: string, args: ValidationArguments): boolean {
    if (getCountryProfile() === CountryProfileEnum.FR) {
      return this.cog.validate(value, args);
    }

    const field = args.constraints[0];
    if (field === 'commune') {
      return typeof value === 'string' && GENERIC_CODE_RE.test(value);
    }
    if (field === 'commune_deleguee') {
      // Optional everywhere it is used.
      return !value || GENERIC_CODE_RE.test(value);
    }
    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    const field = args.constraints[0];
    const message = `Le champ ${field} : ${args.value} n'est pas valide`;
    // Under the default profile the message stays byte-identical to upstream's,
    // so existing clients and tests are unaffected. The profile is only named
    // when it is the non-obvious reason a code was rejected.
    return getCountryProfile() === CountryProfileEnum.FR
      ? message
      : `${message} (profil ${getCountryProfile()})`;
  }
}
