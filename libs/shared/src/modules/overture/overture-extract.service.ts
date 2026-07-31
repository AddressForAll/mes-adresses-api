import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';

import { DuckDbClient } from './duckdb.client';
import {
  Bbox,
  OvertureAddressRow,
  OvertureDivision,
  OvertureSegmentRow,
} from './overture.types';
import {
  assertFinite,
  assertPositiveInt,
  assertRelease,
  assertUuid,
  quoteLiteral,
} from './utils/sql-escape.util';

const S3_ROOT = 's3://overturemaps-us-west-2/release';

/**
 * Reads Overture Maps GeoParquet directly from S3 with DuckDB.
 *
 * The one idea that makes this country-agnostic: a territory is identified by
 * its Overture **division** id, and membership is decided by
 * `ST_Intersects(address.geometry, division.geometry)`.
 *
 * The alternative — inferring membership from address attributes — only works
 * where a country publishes a code system and a crosswalk to go with it (US
 * FIPS being the obvious case). It cannot be generalised. The spatial test
 * needs no reference data at all, and measurement showed it is affordable:
 * for Fresno County the polygon rejects 53% of the rows the bounding box alone
 * would have accepted (791k -> 370k), in about 30 seconds.
 */
@Injectable()
export class OvertureExtractService {
  private readonly logger = new Logger(OvertureExtractService.name);

  constructor(private readonly duckdb: DuckDbClient) {}

  private divisionsPath(release: string): string {
    return `${S3_ROOT}/${release}/theme=divisions/type=division_area/*`;
  }

  private addressesPath(release: string): string {
    return `${S3_ROOT}/${release}/theme=addresses/type=address/*`;
  }

  private transportationPath(release: string): string {
    return `${S3_ROOT}/${release}/theme=transportation/type=segment/*`;
  }

  /**
   * Bounding-box predicate for the division lookup.
   *
   * OVERLAP, not containment — and that distinction cost an hour to find. The
   * bbox we pass in is usually a copy of the division's own bbox, possibly
   * rounded when it travelled through a CLI argument. Rounding it inward makes
   * a containment test reject the very division it describes, the CTE returns
   * no rows, and the cross join below then silently yields zero addresses with
   * no error anywhere.
   */
  private divisionBboxPredicate(bbox?: Bbox): string {
    if (!bbox) return '';
    const x0 = assertFinite(bbox.xmin, 'bbox.xmin');
    const y0 = assertFinite(bbox.ymin, 'bbox.ymin');
    const x1 = assertFinite(bbox.xmax, 'bbox.xmax');
    const y1 = assertFinite(bbox.ymax, 'bbox.ymax');
    return `
      AND (bbox).xmin <= ${x1} AND (bbox).xmax >= ${x0}
      AND (bbox).ymin <= ${y1} AND (bbox).ymax >= ${y0}`;
  }

  /**
   * A CTE yielding the target division's polygon.
   *
   * Only the *geometry* comes from the CTE. The numeric bounds are always
   * interpolated as literals into the caller's WHERE clause, because a bound
   * supplied through a CTE defeats Parquet row-group pruning and turns a
   * targeted read into a full scan of the theme.
   */
  private divisionCte(divisionId: string, release: string, bbox?: Bbox): string {
    return `
      div AS (
        SELECT geometry AS geom
        FROM read_parquet('${this.divisionsPath(release)}', filename=true, hive_partitioning=1)
        WHERE id = ${quoteLiteral(divisionId)}${this.divisionBboxPredicate(bbox)}
        LIMIT 1
      )`;
  }

  /**
   * Search divisions by name — the discovery half of the CLI, so an engineer
   * can find the id to import.
   *
   * This full-scans `division_area` (a LIKE on a name has no row-group
   * statistics to prune on). That theme is small next to addresses, so expect
   * tens of seconds; not worth optimising for an interactive lookup.
   */
  async findDivisions(params: {
    name: string;
    release: string;
    country?: string;
    subtype?: string;
    limit?: number;
  }): Promise<OvertureDivision[]> {
    const release = assertRelease(params.release);
    const limit = assertPositiveInt(params.limit ?? 25, 'limit');

    const filters = [
      `names.primary IS NOT NULL`,
      `lower(names.primary) LIKE lower(${quoteLiteral(`%${params.name}%`)})`,
      params.country ? `country = ${quoteLiteral(params.country.toUpperCase())}` : null,
      params.subtype ? `subtype = ${quoteLiteral(params.subtype.toLowerCase())}` : null,
    ].filter(Boolean);

    const sql = `
      SELECT id,
             names.primary AS name,
             subtype,
             country,
             region,
             (bbox).xmin AS xmin, (bbox).ymin AS ymin,
             (bbox).xmax AS xmax, (bbox).ymax AS ymax,
             ST_Area(geometry) AS area_deg2
      FROM read_parquet('${this.divisionsPath(release)}', filename=true, hive_partitioning=1)
      WHERE ${filters.join('\n        AND ')}
      ORDER BY area_deg2 DESC
      LIMIT ${limit}`;

    const connection = await this.duckdb.connect();
    const rows = await this.duckdb.timed('division search', async () =>
      (await connection.runAndReadAll(sql)).getRowObjects(),
    );
    return rows.map((r) => this.toDivision(r));
  }

  /** Resolve a single division by GERS id. */
  async getDivision(
    divisionId: string,
    release: string,
    bbox?: Bbox,
  ): Promise<OvertureDivision | null> {
    const id = assertUuid(divisionId, 'division id');
    assertRelease(release);

    const sql = `
      SELECT id,
             names.primary AS name,
             subtype,
             country,
             region,
             (bbox).xmin AS xmin, (bbox).ymin AS ymin,
             (bbox).xmax AS xmax, (bbox).ymax AS ymax,
             ST_Area(geometry) AS area_deg2
      FROM read_parquet('${this.divisionsPath(release)}', filename=true, hive_partitioning=1)
      WHERE id = ${quoteLiteral(id)}${this.divisionBboxPredicate(bbox)}
      LIMIT 1`;

    const connection = await this.duckdb.connect();
    const rows = await this.duckdb.timed('division lookup', async () =>
      (await connection.runAndReadAll(sql)).getRowObjects(),
    );
    return rows.length ? this.toDivision(rows[0]) : null;
  }

  /**
   * Extract every address inside a division into a local Parquet file, and
   * return the path plus the row count.
   *
   * Two phases on purpose: the S3 scan is the expensive part and we only want
   * to pay it once, so it lands on local disk and the transform reads back from
   * there in batches. That also keeps the raw DuckDB rows and the transformed
   * entities from being resident at the same time.
   */
  async extractAddressesToFile(params: {
    division: OvertureDivision;
    release: string;
    limit?: number;
  }): Promise<{ filePath: string; count: number }> {
    const { division } = params;
    const release = assertRelease(params.release);
    const id = assertUuid(division.id, 'division id');

    const x0 = assertFinite(division.bbox.xmin, 'bbox.xmin');
    const y0 = assertFinite(division.bbox.ymin, 'bbox.ymin');
    const x1 = assertFinite(division.bbox.xmax, 'bbox.xmax');
    const y1 = assertFinite(division.bbox.ymax, 'bbox.ymax');

    const filePath = path.join(
      this.duckdb.getWorkDir(),
      `addresses-${id}-${release}.parquet`,
    );

    // Points have xmin == xmax, so containment with >=/<= is correct here and
    // strict inequalities would drop addresses sitting exactly on the extreme
    // longitude/latitude of the bounding box.
    const sql = `
      COPY (
        WITH ${this.divisionCte(id, release, division.bbox)}
        SELECT a.id AS gers_id,
               ST_X(a.geometry) AS lon,
               ST_Y(a.geometry) AS lat,
               a.country AS country,
               a.postcode AS postcode,
               a.street AS street,
               a.number AS number,
               a.unit AS unit,
               a.postal_city AS postal_city,
               TRY(a.sources[1].dataset) AS source_dataset
        FROM read_parquet('${this.addressesPath(release)}', filename=true, hive_partitioning=1) a,
             div d
        WHERE a.bbox.xmin >= ${x0} AND a.bbox.xmax <= ${x1}
          AND a.bbox.ymin >= ${y0} AND a.bbox.ymax <= ${y1}
          AND a.street IS NOT NULL AND a.number IS NOT NULL
          AND ST_Intersects(a.geometry, d.geom)
        ${params.limit ? `LIMIT ${assertPositiveInt(params.limit, 'limit')}` : ''}
      ) TO '${filePath}' (FORMAT PARQUET, COMPRESSION ZSTD)`;

    const connection = await this.duckdb.connect();
    await this.duckdb.timed('address extract', () => connection.run(sql));

    const [{ n }] = (
      await connection.runAndReadAll(
        `SELECT count(*) AS n FROM read_parquet('${filePath}')`,
      )
    ).getRowObjects();

    return { filePath, count: Number(n) };
  }

  /**
   * Read a previously extracted Parquet file back in batches.
   *
   * Ordered by street so one street's rows arrive together, which keeps the
   * grouping in the transform predictable.
   */
  async *readAddresses(
    filePath: string,
    batchSize = 50_000,
  ): AsyncGenerator<OvertureAddressRow[]> {
    const connection = await this.duckdb.connect();
    const size = assertPositiveInt(batchSize, 'batchSize');
    let offset = 0;

    for (;;) {
      const rows = (
        await connection.runAndReadAll(
          `SELECT * FROM read_parquet('${filePath}')
           ORDER BY street, number
           LIMIT ${size} OFFSET ${offset}`,
        )
      ).getRowObjects();

      if (rows.length === 0) return;

      yield rows.map((r) => ({
        gersId: this.str(r.gers_id) ?? '',
        lon: Number(r.lon),
        lat: Number(r.lat),
        country: this.str(r.country),
        postcode: this.str(r.postcode),
        street: this.str(r.street) ?? '',
        number: this.str(r.number) ?? '',
        unit: this.str(r.unit),
        postalCity: this.str(r.postal_city),
        sourceDataset: this.str(r.source_dataset),
      }));

      if (rows.length < size) return;
      offset += size;
    }
  }

  /**
   * Named roads inside a division, one row per distinct street name.
   *
   * Overture splits a street into many segments, so this deduplicates in SQL
   * and elects the longest constituent segment as the representative trace
   * (`arg_max` picks the value of one column at the row maximising another, in
   * a single pass). Importing the raw segments instead would create hundreds of
   * voies for one street.
   *
   * `ST_LineMerge(ST_Union_Agg(...))` would be the "nicer" merge but frequently
   * returns a MULTILINESTRING, which `voies.trace geometry(LineString,4326)`
   * cannot store.
   *
   * Note the overlap predicate here, unlike the containment used for address
   * points: a road crossing the boundary must still be considered.
   */
  async extractSegments(params: {
    division: OvertureDivision;
    release: string;
    limit?: number;
  }): Promise<OvertureSegmentRow[]> {
    const { division } = params;
    const release = assertRelease(params.release);
    const id = assertUuid(division.id, 'division id');

    const x0 = assertFinite(division.bbox.xmin, 'bbox.xmin');
    const y0 = assertFinite(division.bbox.ymin, 'bbox.ymin');
    const x1 = assertFinite(division.bbox.xmax, 'bbox.xmax');
    const y1 = assertFinite(division.bbox.ymax, 'bbox.ymax');

    const sql = `
      WITH ${this.divisionCte(id, release, division.bbox)},
      segs AS (
        SELECT s.id AS gers_id,
               s.names.primary AS name,
               s.class AS class,
               s.geometry AS geom,
               ST_Length(s.geometry) AS len
        FROM read_parquet('${this.transportationPath(release)}', filename=true, hive_partitioning=1) s,
             div d
        WHERE s.bbox.xmin <= ${x1} AND s.bbox.xmax >= ${x0}
          AND s.bbox.ymin <= ${y1} AND s.bbox.ymax >= ${y0}
          AND s.subtype = 'road'
          AND s.names.primary IS NOT NULL
          AND ST_Intersects(s.geometry, d.geom)
      )
      SELECT name,
             arg_max(gers_id, len) AS gers_id,
             arg_max(class, len) AS class,
             ST_AsGeoJSON(arg_max(geom, len)) AS geom,
             count(*) AS segment_count,
             sum(len) AS total_len
      FROM segs
      GROUP BY name
      ORDER BY total_len DESC
      ${params.limit ? `LIMIT ${assertPositiveInt(params.limit, 'limit')}` : ''}`;

    const connection = await this.duckdb.connect();
    const rows = await this.duckdb.timed('segment extract', async () =>
      (await connection.runAndReadAll(sql)).getRowObjects(),
    );

    const segments: OvertureSegmentRow[] = [];
    for (const r of rows) {
      const geometry = this.parseLineString(this.str(r.geom));
      if (!geometry) continue;
      segments.push({
        gersId: this.str(r.gers_id) ?? '',
        name: this.str(r.name) ?? '',
        class: this.str(r.class),
        geometry,
        segmentCount: Number(r.segment_count),
      });
    }
    return segments;
  }

  private parseLineString(
    geojson: string | null,
  ): { type: 'LineString'; coordinates: [number, number][] } | null {
    if (!geojson) return null;
    try {
      const parsed = JSON.parse(geojson);
      if (parsed?.type !== 'LineString') return null;
      if (!Array.isArray(parsed.coordinates) || parsed.coordinates.length < 2) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private toDivision(row: Record<string, unknown>): OvertureDivision {
    return {
      id: this.str(row.id) ?? '',
      name: this.str(row.name) ?? '',
      subtype: this.str(row.subtype) ?? '',
      country: this.str(row.country),
      region: this.str(row.region),
      bbox: {
        xmin: Number(row.xmin),
        ymin: Number(row.ymin),
        xmax: Number(row.xmax),
        ymax: Number(row.ymax),
      },
      areaDeg2: Number(row.area_deg2),
    };
  }

  /** DuckDB returns various wrapper types; normalise to string | null. */
  private str(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const s = String(value);
    return s === '' ? null : s;
  }
}
