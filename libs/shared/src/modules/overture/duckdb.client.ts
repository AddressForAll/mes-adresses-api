import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Owns the DuckDB instance used to read Overture's public GeoParquet on S3.
 *
 * One instance per process (so the Parquet metadata/object cache is shared),
 * fresh connections per query. No credentials: the Overture bucket is public.
 */
@Injectable()
export class DuckDbClient implements OnModuleDestroy {
  private readonly logger = new Logger(DuckDbClient.name);
  private instance: DuckDBInstance | null = null;

  /**
   * Where spill files and extracted Parquet live.
   *
   * Read from the environment rather than taken as a constructor argument:
   * Nest would try to inject a `String` provider for a defaulted parameter.
   */
  getWorkDir(): string {
    const workDir = process.env.OVERTURE_WORK_DIR || '/tmp/overture';
    fs.mkdirSync(workDir, { recursive: true });
    return workDir;
  }

  async connect(): Promise<DuckDBConnection> {
    // Imported lazily so that merely loading this module — e.g. in the API
    // process, which never extracts — does not pull in the ~100 MB native addon.
    const { DuckDBInstance } = await import('@duckdb/node-api');

    if (!this.instance) {
      this.instance = await DuckDBInstance.create(':memory:');
    }
    const connection = await this.instance.connect();

    await connection.run(
      'INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;',
    );
    // The Overture bucket lives in us-west-2 regardless of what the data covers.
    await connection.run("SET s3_region='us-west-2';");
    await connection.run('SET enable_object_cache=true;');

    // Tuning, all three load-bearing (established by measuring a 370k-row
    // county extract, which OOMs without them):
    //  - preserve_insertion_order=false: otherwise DuckDB buffers the entire
    //    result to preserve row order and exhausts the memory limit. Order is
    //    irrelevant to us — the transform groups by street name anyway.
    //  - temp_directory: lets it spill to disk instead of failing outright.
    //  - threads: each thread holds its own morsel buffers, and the spatial
    //    join against a many-vertex admin polygon is memory-hungry.
    const spillDir = path.join(this.getWorkDir(), 'duckdb-spill');
    fs.mkdirSync(spillDir, { recursive: true });

    await connection.run('SET preserve_insertion_order=false;');
    await connection.run(`SET temp_directory='${spillDir}';`);
    await connection.run(
      `SET memory_limit='${process.env.OVERTURE_MEMORY_LIMIT || '4GB'}';`,
    );
    await connection.run(
      `SET threads=${Number(process.env.OVERTURE_THREADS) || 4};`,
    );

    return connection;
  }

  async onModuleDestroy(): Promise<void> {
    this.instance = null;
  }

  /** Log a query's wall-clock time — these run for minutes, so silence is bad. */
  async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      this.logger.log(`${label} took ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
  }
}
