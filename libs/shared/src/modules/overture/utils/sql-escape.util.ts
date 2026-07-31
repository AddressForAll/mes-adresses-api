/**
 * SQL literal helpers for the DuckDB queries.
 *
 * DuckDB's Node "Neo" API has no bound-parameter form for `runAndReadAll`, so
 * every value we interpolate has to be escaped or validated here. Centralising
 * it means there is exactly one place to audit.
 *
 * Interpolating bbox bounds as literals is also a deliberate performance
 * choice, not just an API limitation: supplying them through a CTE prevents
 * DuckDB from pruning Parquet row groups, turning a targeted read into a full
 * scan of the theme.
 */

/** Quote and escape a string as a SQL literal (doubling embedded quotes). */
export function quoteLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a GERS id before it reaches a query. Overture ids are UUIDs; if one
 * ever is not, we want a clear error rather than an injected fragment.
 */
export function assertUuid(value: string, label = 'id'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error(`Invalid ${label}: expected a UUID, got ${JSON.stringify(value)}`);
  }
  return value.toLowerCase();
}

/** Validate a number destined for a SQL literal. */
export function assertFinite(value: number, label = 'number'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number, got ${value}`);
  }
  return value;
}

/** Validate a positive integer (row limits, batch sizes). */
export function assertPositiveInt(value: number, label = 'limit'): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: expected a positive integer, got ${value}`);
  }
  return value;
}

/**
 * Overture release identifiers look like "2026-07-22.0". They are interpolated
 * into S3 paths, so validate rather than escape.
 */
export function assertRelease(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(value)) {
    throw new Error(`Invalid Overture release: ${JSON.stringify(value)}`);
  }
  return value;
}
