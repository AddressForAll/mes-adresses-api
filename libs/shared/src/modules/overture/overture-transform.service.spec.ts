import { TypeNumerotationEnum } from '@/shared/entities/voie.entity';
import { PositionTypeEnum } from '@/shared/entities/position.entity';

import { OvertureTransformService } from './overture-transform.service';
import { OvertureAddressRow, OvertureSegmentRow } from './overture.types';

// A real slice of Fresno County, deliberately weighted toward the awkward
// cases: multi-spelling streets and non-integer house numbers.
import * as fixture from './__fixtures__/fresno-sample.json';

const rows = fixture as unknown as OvertureAddressRow[];

describe('OvertureTransformService', () => {
  let service: OvertureTransformService;

  beforeEach(() => {
    service = new OvertureTransformService();
  });

  describe('addressesToBal', () => {
    const run = () =>
      service.addressesToBal(rows, { locale: 'en', source: 'overture-test' });

    it('produces one voie per distinct street, case-insensitively', () => {
      const { payload } = run();
      const distinct = new Set(rows.map((r) => r.street.toUpperCase()));
      expect(payload.voies).toHaveLength(distinct.size);
    });

    it('gives every numero exactly one position', () => {
      const { payload } = run();
      for (const numero of payload.numeros) {
        expect(numero.positions).toHaveLength(1);
        expect(numero.positions[0].type).toBe(PositionTypeEnum.ENTREE);
        expect(numero.positions[0].rank).toBe(0);
        expect(numero.positions[0].point.type).toBe('Point');
      }
    });

    it('carries a GERS id onto every numero', () => {
      // Regression guard: both importMany implementations whitelist fields, so
      // gersId silently vanishes if it is ever dropped from the payload.
      const { payload } = run();
      expect(payload.numeros.length).toBeGreaterThan(0);
      for (const numero of payload.numeros) {
        expect(numero.gersId).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('cross-links every numero to a voie in the payload', () => {
      const { payload } = run();
      const voieIds = new Set(payload.voies.map((v) => v.id));
      for (const numero of payload.numeros) {
        expect(voieIds.has(numero.voieId)).toBe(true);
      }
    });

    it('generates 24-char ObjectId-style ids', () => {
      const { payload } = run();
      for (const voie of payload.voies) {
        expect(voie.id).toMatch(/^[0-9a-f]{24}$/);
      }
      for (const numero of payload.numeros) {
        expect(numero.id).toMatch(/^[0-9a-f]{24}$/);
      }
    });

    it('marks every voie NUMERIQUE and never certifies an address', () => {
      const { payload } = run();
      for (const voie of payload.voies) {
        expect(voie.typeNumerotation).toBe(TypeNumerotationEnum.NUMERIQUE);
      }
      // Overture is third-party data; only a local authority can certify.
      for (const numero of payload.numeros) {
        expect(numero.certifie).toBe(false);
      }
    });

    it('creates no toponymes', () => {
      expect(run().payload.toponymes).toHaveLength(0);
    });

    it('never emits a voie with no numeros', () => {
      const { payload } = run();
      const withNumeros = new Set(payload.numeros.map((n) => n.voieId));
      for (const voie of payload.voies) {
        expect(withNumeros.has(voie.id)).toBe(true);
      }
    });

    it('elects the better spelling for a multi-spelling street', () => {
      const { payload } = run();
      const noms = payload.voies.map((v) => v.nom);
      // McCLAIN ST holds 60% of its street's rows, so it wins over title-casing
      // MCCLAIN ST (which would give the wrong "Mcclain St").
      expect(noms).toContain('McCLAIN ST');
      // S OLIViA AVE is a 1-in-15 typo and must NOT win.
      expect(noms).toContain('S Olivia Ave');
      expect(noms).not.toContain('S OLIViA AVE');
    });

    it('drops a street whose every number is unparseable', () => {
      const result = service.addressesToBal(
        [
          { ...rows[0], street: 'NOWHERE RD', number: 's/n' },
          { ...rows[0], street: 'NOWHERE RD', number: 'S/N' },
        ],
        { locale: 'en', source: 'overture-test' },
      );
      expect(result.payload.voies).toHaveLength(0);
      expect(result.payload.numeros).toHaveLength(0);
      expect(result.rejected.unparseable).toBe(2);
    });

    it('collapses the same address arriving from two sources', () => {
      const row = rows.find((r) => /^\d+$/.test(r.number));
      const result = service.addressesToBal([row, { ...row }], {
        locale: 'en',
        source: 'overture-test',
      });
      expect(result.payload.numeros).toHaveLength(1);
      expect(result.rejected.duplicate).toBe(1);
    });

    it('keeps the same number at a different location', () => {
      const row = rows.find((r) => /^\d+$/.test(r.number));
      const result = service.addressesToBal(
        [row, { ...row, lon: row.lon + 0.01 }],
        { locale: 'en', source: 'overture-test' },
      );
      expect(result.payload.numeros).toHaveLength(2);
      expect(result.rejected.duplicate).toBe(0);
    });

    it('preserves the source string on positions', () => {
      const { payload } = service.addressesToBal(rows.slice(0, 5), {
        locale: 'en',
        source: 'overture-2026-07-22.0',
      });
      for (const numero of payload.numeros) {
        expect(numero.positions[0].source).toBe('overture-2026-07-22.0');
      }
    });

    it('accounts for every input row', () => {
      const { payload, rejected } = run();
      const skipped =
        rejected.empty +
        rejected.unparseable +
        rejected.outOfRange +
        rejected.duplicate;
      expect(payload.numeros.length + skipped).toBe(rows.length);
    });
  });

  describe('segmentsToBal', () => {
    const segment = (over: Partial<OvertureSegmentRow> = {}): OvertureSegmentRow => ({
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
      segmentCount: 3,
      ...over,
    });

    it('produces METRIQUE voies carrying the trace and GERS id', () => {
      const { payload } = service.segmentsToBal([segment()]);
      expect(payload.voies).toHaveLength(1);
      expect(payload.voies[0].typeNumerotation).toBe(TypeNumerotationEnum.METRIQUE);
      expect(payload.voies[0].nom).toBe('N Blackstone Ave');
      expect(payload.voies[0].trace.coordinates).toHaveLength(2);
      expect(payload.voies[0].gersId).toBe('11111111-1111-4111-8111-111111111111');
      expect(payload.numeros).toHaveLength(0);
    });

    it('rejects a degenerate trace', () => {
      const { payload, rejected } = service.segmentsToBal([
        segment({
          geometry: { type: 'LineString', coordinates: [[-119.79, 36.75]] },
        }),
      ]);
      expect(payload.voies).toHaveLength(0);
      expect(rejected.unparseable).toBe(1);
    });

    it('rejects an unnamed road', () => {
      const { payload, rejected } = service.segmentsToBal([segment({ name: '  ' })]);
      expect(payload.voies).toHaveLength(0);
      expect(rejected.empty).toBe(1);
    });
  });
});
