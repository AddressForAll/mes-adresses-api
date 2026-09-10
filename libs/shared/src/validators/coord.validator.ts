import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import * as proj from '@etalab/project-legal';
import { Point } from '@turf/turf';
import { getValidateurBalColumnErrors } from '../utils/validateur-bal.utils';
import {
  CountryProfileEnum,
  getCountryProfile,
} from './territory_code.validator';

function harmlessProj(coordinates: number[]) {
  try {
    return proj(coordinates);
  } catch {}
}

/**
 * Plain WGS84 bounds. Used instead of the French legal projection under
 * COUNTRY_PROFILE=generic: project-legal only knows French territories (Lambert
 * 93 and the outre-mer CRSs) and returns null anywhere else, which rejected
 * every position outside France — so no numero of an Overture-imported BAL
 * could be created or edited through the API.
 */
function isWgs84([lon, lat]: number[]): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

@ValidatorConstraint({ name: 'pointCoord', async: true })
export class PointValidator implements ValidatorConstraintInterface {
  async validate(point: Point) {
    if (Array.isArray(point.coordinates) && point.coordinates.length === 2) {
      if (
        typeof point.coordinates[0] !== 'number' ||
        typeof point.coordinates[1] !== 'number'
      ) {
        return false;
      }
      if (getCountryProfile() === CountryProfileEnum.GENERIC) {
        return isWgs84(point.coordinates);
      }
      const projectedCoordInMeters = harmlessProj(point.coordinates);
      if (!projectedCoordInMeters) {
        return false;
      }
    } else {
      return false;
    }

    return true;
  }
}

@ValidatorConstraint({ name: 'lineStringCoord', async: true })
export class LineStringValidator implements ValidatorConstraintInterface {
  async validate(coordinates: any) {
    if (Array.isArray(coordinates)) {
      for (const coor of coordinates) {
        if (Array.isArray(coor)) {
          const [lat, long] = coor;
          if (typeof lat !== 'number' || typeof long !== 'number') {
            return false;
          }

          const latResults = await getValidateurBalColumnErrors(
            'lat',
            lat.toString(),
          );
          if (latResults.errors.length > 0) {
            return false;
          }

          const longResults = await getValidateurBalColumnErrors(
            'long',
            long.toString(),
          );
          if (longResults.errors.length > 0) {
            return false;
          }
        }
      }
    } else {
      return false;
    }

    return true;
  }

  defaultMessage() {
    return 'Les coordonnées de la lineString ne sont pas valide';
  }
}
