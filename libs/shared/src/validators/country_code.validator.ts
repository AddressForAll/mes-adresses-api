import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** ISO 3166-1 alpha-2, lowercase — matches `bases_locales.country`. */
const COUNTRY_CODE_RE = /^[a-z]{2}$/;

/**
 * Validates an optional country code on BAL creation. Kept deliberately
 * permissive (any well-formed alpha-2 code, not a fixed enum) so a new
 * country needs no API deploy — just an entry in the frontend's
 * `src/lib/countries` registry and, for real BAL creation, importer support.
 */
@ValidatorConstraint({ name: 'validatorCountryCode' })
export class ValidatorCountryCode implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    return value === undefined || COUNTRY_CODE_RE.test(value);
  }

  defaultMessage(): string {
    return `Le champ country doit être un code pays ISO 3166-1 alpha-2 en minuscules`;
  }
}
