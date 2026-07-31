import { GlobalEntity } from './global.entity';
import { ApiProperty } from '@nestjs/swagger';
import { AfterLoad, Column, Entity, OneToMany } from 'typeorm';
import { Voie } from './voie.entity';
import { Numero } from './numero.entity';
import { Toponyme } from './toponyme.entity';
import { getCommune } from '../utils/cog.utils';

export enum ImportTypeEnum {
  API_DEPOT = 'api-depot',
  BAN = 'ban',
  CSV = 'csv',
  OVERTURE = 'overture',
}

export enum StatusBaseLocalEnum {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  DEMO = 'demo',
  REPLACED = 'replaced',
}

export enum StatusSyncEnum {
  OUTDATED = 'outdated',
  SYNCED = 'synced',
  CONFLICT = 'conflict',
}

export class BaseLocaleFondDeCarte {
  @ApiProperty()
  name: string;

  @ApiProperty()
  url: string;
}

export class BaseLocaleSetting {
  @ApiProperty()
  otherBalPublishedIgnored: boolean;

  @ApiProperty()
  languageGoalIgnored: boolean;

  @ApiProperty()
  toponymeGoalIgnored: boolean;

  @ApiProperty({ type: () => BaseLocaleFondDeCarte, isArray: true })
  fondsDeCartes: BaseLocaleFondDeCarte[];

  @ApiProperty({ type: () => String, isArray: true })
  ignoredAlertCodes: string[];
}

export class BaseLocaleSync {
  @ApiProperty({ enum: StatusSyncEnum })
  status: StatusSyncEnum;

  @ApiProperty()
  isPaused?: boolean;

  @ApiProperty()
  lastUploadedRevisionId: string;

  @ApiProperty()
  currentUpdated?: Date;
}

@Entity({ name: 'bases_locales' })
export class BaseLocale extends GlobalEntity {
  @ApiProperty()
  @Column('text', { nullable: false })
  nom: string;

  @ApiProperty({ required: false, type: String })
  communeNom?: string;

  @ApiProperty()
  @Column('json', { name: 'commune_noms_alt', nullable: true })
  communeNomsAlt: Record<string, string> | null;

  /**
   * Opaque territory code. Historically a French INSEE/COG code; since the
   * Overture importer it may also be a foreign administrative code (US place
   * FIPS, Brazilian IBGE, …) or a synthetic code derived from an Overture
   * division id. Which values are accepted is decided by ValidatorTerritoryCode
   * according to COUNTRY_PROFILE — see libs/shared/src/validators.
   */
  @ApiProperty()
  @Column('varchar', { nullable: false, length: 16 })
  commune: string;

  /**
   * Overture Maps division (GERS) id this BAL's addresses were imported from,
   * when populated by the Overture importer. Null for every other import path.
   */
  @ApiProperty({ required: false, type: String })
  @Column('uuid', { name: 'source_division_id', nullable: true })
  sourceDivisionId: string | null;

  /**
   * ISO 3166-1 alpha-2 country code, lowercase. Drives country-dependent
   * frontend behaviour (basemaps, cadastre availability, commune search) —
   * see mes-adresses-CV's `src/lib/countries`. Defaults to 'fr' for every
   * BAL created before this field existed. The Overture importer sets it
   * from `OvertureDivision.country`; every other creation path leaves the
   * default.
   */
  @ApiProperty()
  @Column('varchar', { nullable: false, length: 2, default: 'fr' })
  country: string;

  @ApiProperty()
  @Column('text', { nullable: true, array: true })
  emails: string[];

  @ApiProperty()
  @Column('varchar', { nullable: false, length: 20 })
  token: string;

  @ApiProperty({ enum: StatusBaseLocalEnum })
  @Column('enum', { enum: StatusBaseLocalEnum, nullable: false })
  status: StatusBaseLocalEnum;

  @ApiProperty({ enum: ImportTypeEnum })
  @Column('enum', {
    enum: ImportTypeEnum,
    name: 'import_type',
    nullable: true,
  })
  importType: ImportTypeEnum;

  @ApiProperty()
  @Column('varchar', { name: 'habilitation_id', nullable: true, length: 24 })
  habilitationId: string | null;

  @ApiProperty({ type: () => BaseLocaleSync })
  @Column('jsonb', { nullable: true })
  sync: BaseLocaleSync | null;

  @ApiProperty({ type: () => BaseLocaleSetting })
  @Column('jsonb', { nullable: true })
  settings: BaseLocaleSetting | null;

  @ApiProperty({ type: () => Voie, isArray: true })
  @OneToMany(() => Voie, (voie) => voie.baseLocale)
  voies?: Voie[];

  @ApiProperty({ type: () => Toponyme, isArray: true })
  @OneToMany(() => Toponyme, (toponyme) => toponyme.baseLocale)
  toponymes?: Toponyme[];

  @ApiProperty({ type: () => Numero, isArray: true })
  @OneToMany(() => Numero, (numero) => numero.baseLocale)
  numeros?: Numero[];

  @AfterLoad()
  getCommuneNom?(): void {
    this.communeNom = getCommune(this.commune)?.nom;
  }
}
