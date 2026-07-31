import {
  getCommune,
  getCommunesPrecedentesByChefLieu,
} from '@/shared/utils/cog.utils';
import {
  checkHasCadastre,
  checkHasMapsStyles,
  checkIsCommuneOutreMer,
} from '@/lib/utils/commune.utils';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CommuneDTO } from './dto/commune.dto';
import { CogTocadastre } from '@/lib/utils/cog_to_cadastre.util';
import {
  CountryProfileEnum,
  getCountryProfile,
} from '@/shared/validators/territory_code.validator';

@Injectable()
export class CommuneService {
  constructor() {}

  /**
   * Descriptor for a territory whose code is not in the French COG — an
   * Overture-imported BAL, for instance.
   *
   * The editor calls this endpoint while opening a BAL and treats a failure as
   * fatal, so 404-ing here makes such a BAL impossible to open at all. Every
   * capability advertised is French-specific (cadastre parcels, IGN map styles,
   * communes déléguées), so they are simply reported as unavailable. The
   * headline name shown in the editor comes from `bases_locales.nom`, not from
   * here.
   */
  private getForeignTerritoryExtraData(codeCommune: string): CommuneDTO {
    return {
      code: codeCommune,
      nom: codeCommune,
      communesDeleguees: [],
      hasCadastre: false,
      isCOM: false,
      hasOpenMapTiles: false,
      hasOrtho: false,
      hasPlanIGN: false,
    };
  }

  getCommuneExtraData(codeCommune: string): CommuneDTO {
    const commune = getCommune(codeCommune);
    if (!commune) {
      // Under the default French profile, an unknown code is still an error —
      // upstream behaviour is unchanged.
      if (getCountryProfile() === CountryProfileEnum.GENERIC) {
        return this.getForeignTerritoryExtraData(codeCommune);
      }
      throw new HttpException(
        `Commune ${codeCommune} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const isCOM = checkIsCommuneOutreMer(codeCommune);
    const hasMapsStyles = checkHasMapsStyles(codeCommune, isCOM);
    const communesDeleguees = getCommunesPrecedentesByChefLieu(codeCommune);

    // Le COG en cours n'est pas pris en compte par le cadastre
    // Donc si les précédente commune existent dans le cadastre, on les map pour les affiché en front
    let communeDelegueesHasCadastre = [];
    if (communesDeleguees.length > 0) {
      communeDelegueesHasCadastre = communesDeleguees
        .filter(({ code }) => checkHasCadastre(code))
        .map(({ code }) => code);
    }

    // On vérifie si la commune (ou ses précédentes) a un cadastre
    const hasCadastre =
      checkHasCadastre(CogTocadastre[codeCommune] || codeCommune) ||
      communeDelegueesHasCadastre.length > 0;

    // Si le code_insee ne correspond pas au code commune du cadastre, on map les bon code commune
    let codeCommunesCadastre = [];
    if (CogTocadastre[codeCommune]) {
      codeCommunesCadastre.push(CogTocadastre[codeCommune]);
    } else if (communeDelegueesHasCadastre.length > 0) {
      codeCommunesCadastre = communeDelegueesHasCadastre;
    }

    return {
      code: commune.code,
      ...(codeCommunesCadastre.length > 0 && { codeCommunesCadastre }),
      nom: commune.nom,
      communesDeleguees,
      hasCadastre,
      isCOM,
      ...hasMapsStyles,
    };
  }
}
