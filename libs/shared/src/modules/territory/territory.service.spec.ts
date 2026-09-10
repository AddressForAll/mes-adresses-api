import { TerritoryService } from './territory.service';
import { territoryCodeFromDivision } from './territory-code.util';

// Fresno County's Overture division_area id — the one the local and prod
// imports were run with (`yarn overture:import --division …`).
const FRESNO_DIVISION_ID = '197cfe35-a268-4674-b1ba-b68dc1b3ee6a';
const FRESNO_CODE = 'US-197cfe35';

describe('territoryCodeFromDivision', () => {
  it('prefixes the country and keeps 8 hex digits of the id', () => {
    expect(territoryCodeFromDivision('US', FRESNO_DIVISION_ID)).toBe(
      FRESNO_CODE,
    );
    expect(territoryCodeFromDivision('us', FRESNO_DIVISION_ID)).toBe(
      FRESNO_CODE,
    );
  });

  it('falls back to XX for a division without a country', () => {
    expect(territoryCodeFromDivision(null, FRESNO_DIVISION_ID)).toBe(
      'XX-197cfe35',
    );
  });
});

describe('TerritoryService', () => {
  const service = new TerritoryService();

  it('lists US states at the top level, not selectable', () => {
    const states = service.listTerritories('us');
    const california = states.find((s) => s.nom === 'California');

    expect(states.length).toBeGreaterThanOrEqual(50);
    expect(california).toMatchObject({
      level: 'state',
      path: [],
      hasChildren: true,
      selectable: false,
    });
  });

  it('gives Fresno County the code the importer derives, so both paths agree', () => {
    const california = service
      .listTerritories('us')
      .find((s) => s.nom === 'California');
    const fresno = service
      .listTerritories('us', california.code)
      .find((c) => c.nom === 'Fresno County');

    expect(fresno).toMatchObject({
      code: FRESNO_CODE,
      divisionId: FRESNO_DIVISION_ID,
      level: 'county',
      path: [california.code],
      selectable: true,
    });
    expect(service.findTerritory(FRESNO_CODE)).toEqual(fresno);
  });

  it('lists places under a county, with the full path', () => {
    const places = service.listTerritories('us', FRESNO_CODE);
    const city = places.find((p) => p.nom === 'Fresno');

    expect(city).toMatchObject({
      level: 'place',
      selectable: true,
      hasChildren: false,
    });
    expect(city.path).toHaveLength(2);
    expect(city.path[1]).toBe(FRESNO_CODE);
    // A place's bbox sits inside its county's.
    const [xmin, ymin, xmax, ymax] = service.findTerritory(FRESNO_CODE).bbox;
    expect(city.bbox[0]).toBeGreaterThanOrEqual(xmin);
    expect(city.bbox[1]).toBeGreaterThanOrEqual(ymin);
    expect(city.bbox[2]).toBeLessThanOrEqual(xmax);
    expect(city.bbox[3]).toBeLessThanOrEqual(ymax);
  });

  it('keeps a childless top-level territory selectable (District of Columbia)', () => {
    const dc = service
      .listTerritories('us')
      .find((s) => s.nom === 'District of Columbia');

    expect(dc).toMatchObject({ hasChildren: false, selectable: true });
  });

  it('returns null for an unknown country or parent', () => {
    expect(service.listTerritories('zz')).toBeNull();
    expect(service.listTerritories('us', 'US-00000000')).toBeNull();
    expect(service.findTerritory('US-00000000')).toBeNull();
    expect(service.findTerritory('38339')).toBeNull();
  });
});
