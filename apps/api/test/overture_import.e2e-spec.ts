import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Repository } from 'typeorm';
import * as request from 'supertest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

import { Numero } from '@/shared/entities/numero.entity';
import { Voie, TypeNumerotationEnum } from '@/shared/entities/voie.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { MailerModule } from '@/shared/test/mailer.module.test';
import { BaseLocaleModule } from '@/modules/base_locale/base_locale.module';
import { BaseLocaleService } from '@/modules/base_locale/base_locale.service';
import { OvertureTransformService } from '@/shared/modules/overture/overture-transform.service';
import { OvertureAddressRow } from '@/shared/modules/overture/overture.types';
import {
  CountryProfileEnum,
  ValidatorTerritoryCode,
  resetCountryProfileCache,
} from '@/shared/validators/territory_code.validator';

import * as fixture from '@/shared/modules/overture/__fixtures__/fresno-sample.json';
import {
  createBal,
  deleteRepositories,
  getTypeORMModule,
  getTypeormRepository,
  initTypeormRepository,
  startPostgresContainer,
  stopPostgresContainer,
} from './typeorm.utils';

const BAN_API_URL = 'BAN_API_URL';
process.env.BAN_API_URL = BAN_API_URL;

const rows = fixture as unknown as OvertureAddressRow[];

/**
 * End-to-end cover for the Overture import path.
 *
 * Runs entirely offline: the Overture SQL is not exercised here (that needs S3
 * and minutes of scanning). Instead the real transform feeds the real
 * `BaseLocaleService.populate()`, which is where the interesting failure modes
 * live — field whitelisting in importMany, centroid computation, and the
 * widened territory-code column.
 */
describe('OVERTURE IMPORT', () => {
  let app: INestApplication;
  let repositories: {
    numeros: Repository<Numero>;
    voies: Repository<Voie>;
    bals: Repository<BaseLocale>;
    toponymes: Repository<Toponyme>;
  };
  let baseLocaleService: BaseLocaleService;
  const transform = new OvertureTransformService();
  const axiosMock = new MockAdapter(axios);

  beforeAll(async () => {
    await startPostgresContainer();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [getTypeORMModule(), BaseLocaleModule, MailerModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    initTypeormRepository(app);
    repositories = getTypeormRepository();
    baseLocaleService = app.get(BaseLocaleService);
  });

  afterEach(async () => {
    axiosMock.reset();
    await deleteRepositories();
    resetCountryProfileCache();
    delete process.env.COUNTRY_PROFILE;
  });

  afterAll(async () => {
    await stopPostgresContainer();
    await app.close();
  });

  const populateFromFixture = async (balId: string) => {
    const bal = await repositories.bals.findOneBy({ id: balId });
    const { payload } = transform.addressesToBal(rows, {
      locale: 'en',
      source: 'overture-test',
    });
    await baseLocaleService.populate(bal, {
      voies: payload.voies,
      numeros: payload.numeros,
      toponymes: [],
    });
    return payload;
  };

  describe('populate() with Overture data', () => {
    it('persists voies, numeros and one position each', async () => {
      const balId = await createBal({ nom: 'overture', commune: '91400' });
      const payload = await populateFromFixture(balId);

      const [voies, numeros] = await Promise.all([
        repositories.voies.countBy({ balId }),
        repositories.numeros.countBy({ balId }),
      ]);
      expect(voies).toBe(payload.voies.length);
      expect(numeros).toBe(payload.numeros.length);

      const positions = await repositories.numeros.query(
        `SELECT count(*)::int AS n FROM positions p
           JOIN numeros n ON n.id = p.numero_id WHERE n.bal_id = $1`,
        [balId],
      );
      expect(positions[0].n).toBe(numeros);
    });

    it('stores a GERS id on every numero', async () => {
      // Regression guard for numeroService.importMany, which whitelists the
      // fields it inserts — gersId is silently dropped if removed from it.
      const balId = await createBal({ nom: 'overture', commune: '91400' });
      await populateFromFixture(balId);

      const [{ total, withGers }] = await repositories.numeros.query(
        `SELECT count(*)::int AS total,
                count(gers_id)::int AS "withGers"
           FROM numeros WHERE bal_id = $1`,
        [balId],
      );
      expect(total).toBeGreaterThan(0);
      expect(withGers).toBe(total);
    });

    it('computes a centroid and bbox for every voie', async () => {
      const balId = await createBal({ nom: 'overture', commune: '91400' });
      await populateFromFixture(balId);

      const [{ n }] = await repositories.voies.query(
        `SELECT count(*)::int AS n FROM voies
          WHERE bal_id = $1 AND (centroid IS NULL OR bbox IS NULL)`,
        [balId],
      );
      expect(n).toBe(0);
    });

    it('replaces rather than duplicates when re-imported', async () => {
      const balId = await createBal({ nom: 'overture', commune: '91400' });
      await populateFromFixture(balId);
      const first = await repositories.numeros.countBy({ balId });

      await populateFromFixture(balId);
      const second = await repositories.numeros.countBy({ balId });

      expect(second).toBe(first);

      // And nothing is left dangling behind the deleted numeros.
      const [{ orphans }] = await repositories.numeros.query(
        `SELECT count(*)::int AS orphans FROM positions p
           LEFT JOIN numeros n ON n.id = p.numero_id WHERE n.id IS NULL`,
      );
      expect(orphans).toBe(0);
    });

    it('stores METRIQUE voies with a trace for the streets fallback', async () => {
      const balId = await createBal({ nom: 'overture', commune: '91400' });
      const bal = await repositories.bals.findOneBy({ id: balId });

      const { payload } = transform.segmentsToBal([
        {
          gersId: '11111111-1111-4111-8111-111111111111',
          name: 'N BLACKSTONE AVE',
          class: 'primary',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-119.79, 36.75],
              [-119.79, 36.76],
            ],
          },
          segmentCount: 2,
        },
      ]);
      await baseLocaleService.populate(bal, {
        voies: payload.voies,
        numeros: [],
        toponymes: [],
      });

      const voie = await repositories.voies.findOneBy({ balId });
      expect(voie.nom).toBe('N Blackstone Ave');
      expect(voie.typeNumerotation).toBe(TypeNumerotationEnum.METRIQUE);
      expect(voie.trace).not.toBeNull();
      expect(voie.gersId).toBe('11111111-1111-4111-8111-111111111111');
      // Derived from the trace, not from numeros.
      expect(voie.centroid).not.toBeNull();
      expect(voie.bbox).not.toBeNull();
    });
  });

  describe('territory codes', () => {
    it('persists a code longer than the old 5-char limit', async () => {
      // bases_locales.commune was varchar(5); Overture-derived codes need more.
      const balId = await createBal({
        nom: 'overture',
        commune: 'US-197cfe35',
      });
      const bal = await repositories.bals.findOneBy({ id: balId });
      expect(bal.commune).toBe('US-197cfe35');
    });

    it('records the source division and import type', async () => {
      const balId = await createBal({
        nom: 'overture',
        commune: 'US-197cfe35',
      });
      await repositories.bals.update(
        { id: balId },
        { sourceDivisionId: '197cfe35-a268-4674-b1ba-b68dc1b3ee6a' },
      );
      const bal = await repositories.bals.findOneBy({ id: balId });
      expect(bal.sourceDivisionId).toBe('197cfe35-a268-4674-b1ba-b68dc1b3ee6a');
    });

    it('falls back to the stored name for a code outside the COG', async () => {
      const balId = await createBal({
        nom: 'overture',
        commune: 'US-197cfe35',
      });
      let bal = await repositories.bals.findOneBy({ id: balId });
      expect(bal.communeNom).toBeNull();

      await repositories.bals.update(
        { id: balId },
        { communeNom: 'Fresno County' },
      );
      bal = await repositories.bals.findOneBy({ id: balId });
      expect(bal.communeNom).toBe('Fresno County');
    });

    it('prefers the COG name over a stored one for a French commune', async () => {
      const balId = await createBal({ nom: 'bal', commune: '08053' });
      await repositories.bals.update({ id: balId }, { communeNom: 'Stale' });
      const bal = await repositories.bals.findOneBy({ id: balId });
      expect(bal.communeNom).toBe('Bazeilles');
    });
  });

  describe('BALs created from the territory selectors', () => {
    const mockBanDistrict = (code: string) =>
      axiosMock
        .onGet(`${BAN_API_URL}/api/district/cog/${code}`)
        .reply(200, {
          response: [{ id: '00000000-0000-4000-8000-000000000000' }],
        });

    it('stores the catalog name of a territory at creation', async () => {
      mockBanDistrict('US-197cfe35');
      const { id } = await baseLocaleService.createOne({
        nom: 'Addresses of Fresno County',
        emails: ['clerk@example.org'],
        commune: 'US-197cfe35',
        country: 'us',
      });

      const bal = await repositories.bals.findOneBy({ id });
      expect(bal.communeNom).toBe('Fresno County');
      expect(bal.country).toBe('us');
    });

    it('names a demo BAL after its territory', async () => {
      mockBanDistrict('US-197cfe35');
      const { id } = await baseLocaleService.createDemo({
        commune: 'US-197cfe35',
        country: 'us',
      });

      const bal = await repositories.bals.findOneBy({ id });
      expect(bal.nom).toBe('Adresses de Fresno County [démo]');
      expect(bal.communeNom).toBe('Fresno County');
    });

    it('leaves commune_nom NULL for a code outside every catalog', async () => {
      // Storing the raw code would make "no name yet" indistinguishable
      // from a real name.
      mockBanDistrict('BR-3550308');
      const { id } = await baseLocaleService.createOne({
        nom: 'São Paulo',
        emails: ['clerk@example.org'],
        commune: 'BR-3550308',
      });

      const bal = await repositories.bals.findOneBy({ id });
      expect(bal.communeNom).toBeNull();
    });

    it('finds existing BALs by territory code under the generic profile', async () => {
      process.env.COUNTRY_PROFILE = CountryProfileEnum.GENERIC;
      resetCountryProfileCache();
      await createBal({ nom: 'overture', commune: 'US-197cfe35' });

      const response = await request(app.getHttpServer())
        .get('/bases-locales/search')
        .query({ commune: 'US-197cfe35', status: 'draft' })
        .expect(200);

      expect(response.body.count).toBe(1);
    });
  });

  describe('ValidatorTerritoryCode', () => {
    const validator = new ValidatorTerritoryCode();
    const check = (value: string, field = 'commune') =>
      validator.validate(value, {
        constraints: [field],
        value,
      } as never);

    it('keeps upstream French behaviour by default', () => {
      resetCountryProfileCache();
      delete process.env.COUNTRY_PROFILE;
      expect(check('54084')).toBe(true);
      expect(check('US-197cfe35')).toBe(false);
      expect(check('00000')).toBe(false);
    });

    it('accepts opaque codes under the generic profile', () => {
      resetCountryProfileCache();
      process.env.COUNTRY_PROFILE = CountryProfileEnum.GENERIC;
      expect(check('US-197cfe35')).toBe(true);
      expect(check('06019')).toBe(true);
      expect(check('3550308')).toBe(true); // Brazilian IBGE
      expect(check('54084')).toBe(true);
    });

    it('still rejects malformed codes under the generic profile', () => {
      resetCountryProfileCache();
      process.env.COUNTRY_PROFILE = CountryProfileEnum.GENERIC;
      expect(check('has space')).toBe(false);
      expect(check('a/b')).toBe(false);
      expect(check('x')).toBe(false);
      expect(check('0123456789abcdefg')).toBe(false); // 17 chars
    });

    it('leaves commune_deleguee optional', () => {
      resetCountryProfileCache();
      process.env.COUNTRY_PROFILE = CountryProfileEnum.GENERIC;
      expect(check('', 'commune_deleguee')).toBe(true);
      expect(check('US-197cfe35', 'commune_deleguee')).toBe(true);
      expect(check('has space', 'commune_deleguee')).toBe(false);
    });
  });
});
