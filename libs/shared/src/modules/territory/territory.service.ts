import { Injectable } from '@nestjs/common';

import * as usCatalog from './data/us.json';
import { territoryCodeFromDivision } from './territory-code.util';

/**
 * One node of a catalog file, as written by scripts/build-territories.js:
 * `[divisionAreaId, name, [xmin, ymin, xmax, ymax], children?]`.
 * Tuples rather than objects keep the US file under 3 MB.
 */
type CatalogNode = [string, string, number[], CatalogNode[]?];

type CatalogFile = {
  country: string;
  source: string;
  levels: string[];
  territories: CatalogNode[];
};

/**
 * Levels above this one only narrow the search (a whole US state is far too
 * big to be one BAL). A level-less leaf — the District of Columbia has no
 * county below it — stays selectable regardless.
 */
const SELECTABLE_FROM: Record<string, string> = {
  us: 'county',
};

export type Territory = {
  /** Opaque territory code stored in `bases_locales.commune`. */
  code: string;
  nom: string;
  level: string;
  /** Overture division_area GERS id — what `overture:import --division` takes. */
  divisionId: string;
  bbox: number[];
  /** Codes of the ancestors, top-down. Empty for a top-level territory. */
  path: string[];
  hasChildren: boolean;
  /** Whether a BAL can be created for this territory. */
  selectable: boolean;
};

type Indexed = {
  territory: Territory;
  children: Territory[];
};

type CountryIndex = {
  roots: Territory[];
  byCode: Map<string, Indexed>;
};

/**
 * Administrative territories for countries whose BALs are not French
 * communes, backing the editor's cascading selectors (state → county → place
 * for the US).
 *
 * Built from Overture divisions and keyed by the same division id the
 * importer uses, so codes agree between the two — see territory-code.util.ts.
 * Static data loaded once: the selectors need an instant answer, and scanning
 * Overture on S3 takes tens of seconds.
 */
@Injectable()
export class TerritoryService {
  private readonly catalogs: Record<string, CatalogFile> = {
    us: usCatalog as unknown as CatalogFile,
  };

  private readonly indexes = new Map<string, CountryIndex>();

  hasCountry(country: string): boolean {
    return Boolean(this.catalogs[country]);
  }

  /**
   * Children of `parentCode`, or the top level when it is omitted. `null`
   * when the country or the parent is unknown.
   */
  listTerritories(country: string, parentCode?: string): Territory[] | null {
    const index = this.getIndex(country);
    if (!index) return null;
    if (!parentCode) return index.roots;
    return index.byCode.get(parentCode)?.children ?? null;
  }

  /** Look a territory up by its code, in whichever catalog holds it. */
  findTerritory(code: string): Territory | null {
    const country = code?.split('-')[0]?.toLowerCase();
    if (!country) return null;
    return this.getIndex(country)?.byCode.get(code)?.territory ?? null;
  }

  private getIndex(country: string): CountryIndex | null {
    const catalog = this.catalogs[country];
    if (!catalog) return null;

    if (!this.indexes.has(country)) {
      this.indexes.set(country, this.buildIndex(catalog));
    }
    return this.indexes.get(country);
  }

  private buildIndex(catalog: CatalogFile): CountryIndex {
    const byCode = new Map<string, Indexed>();
    const selectableFrom = catalog.levels.indexOf(
      SELECTABLE_FROM[catalog.country] ?? catalog.levels[0],
    );

    const visit = (
      [divisionId, nom, bbox, children = []]: CatalogNode,
      depth: number,
      path: string[],
    ): Territory => {
      const territory: Territory = {
        code: territoryCodeFromDivision(catalog.country, divisionId),
        nom,
        level: catalog.levels[depth],
        divisionId,
        bbox,
        path,
        hasChildren: children.length > 0,
        selectable: depth >= selectableFrom || children.length === 0,
      };
      const childPath = [...path, territory.code];
      byCode.set(territory.code, {
        territory,
        children: children.map((child) => visit(child, depth + 1, childPath)),
      });
      return territory;
    };

    return {
      roots: catalog.territories.map((node) => visit(node, 0, [])),
      byCode,
    };
  }
}
