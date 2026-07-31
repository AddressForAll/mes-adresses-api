/**
 * Types for the Overture Maps importer.
 *
 * Deliberately free of any country-specific concept: no FIPS, no state/county
 * vocabulary, no per-country reference data. A territory is identified by its
 * Overture division (GERS) id, which exists worldwide at every administrative
 * level.
 */

/**
 * Overture's administrative hierarchy, largest to smallest.
 * @see https://docs.overturemaps.org/guides/divisions/
 */
export enum OvertureDivisionSubtype {
  COUNTRY = 'country',
  DEPENDENCY = 'dependency',
  MACROREGION = 'macroregion',
  REGION = 'region',
  MACROCOUNTY = 'macrocounty',
  COUNTY = 'county',
  LOCALADMIN = 'localadmin',
  LOCALITY = 'locality',
  BOROUGH = 'borough',
  MACROHOOD = 'macrohood',
  NEIGHBORHOOD = 'neighborhood',
  MICROHOOD = 'microhood',
}

/**
 * Subtypes whose bounding box is so large that extracting them would scan a
 * continent's worth of Parquet. Refused unless --force is given.
 */
export const OVERSIZED_SUBTYPES: ReadonlySet<string> = new Set([
  OvertureDivisionSubtype.COUNTRY,
  OvertureDivisionSubtype.DEPENDENCY,
  OvertureDivisionSubtype.MACROREGION,
]);

export type Bbox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type OvertureDivision = {
  /** GERS id — stable across Overture releases. */
  id: string;
  /** names.primary */
  name: string;
  subtype: OvertureDivisionSubtype | string;
  /** ISO 3166-1 alpha-2, e.g. "US", "FR", "BR". May be null on odd features. */
  country: string | null;
  /** ISO 3166-2 subdivision, e.g. "US-CA". */
  region: string | null;
  bbox: Bbox;
  /** ST_Area in square degrees — used by the size guard, not for real geodesy. */
  areaDeg2: number;
};

/** One row of the Overture addresses theme, flattened. */
export type OvertureAddressRow = {
  gersId: string;
  lon: number;
  lat: number;
  country: string | null;
  postcode: string | null;
  street: string;
  number: string;
  unit: string | null;
  postalCity: string | null;
  /** sources[1].dataset — provenance only, never used for attribution. */
  sourceDataset: string | null;
};

/** One deduplicated named road from the Overture transportation theme. */
export type OvertureSegmentRow = {
  gersId: string;
  name: string;
  class: string | null;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  /** How many raw segments collapsed into this named road. */
  segmentCount: number;
};

/** Why a source row did not become a numero. */
export type RejectionReport = {
  /** street or number was empty/blank */
  empty: number;
  /** number had no leading digits at all ("s/n", "A12", block addressing) */
  unparseable: number;
  /** number outside 0..99998 (99999 is BAL's toponyme-only sentinel) */
  outOfRange: number;
  /** same street+number at the same coordinates, already seen */
  duplicate: number;
};

export const emptyRejectionReport = (): RejectionReport => ({
  empty: 0,
  unparseable: 0,
  outOfRange: 0,
  duplicate: 0,
});

export type OvertureImportReport = {
  release: string;
  divisionId: string;
  divisionName: string;
  scannedRows: number;
  voies: number;
  numeros: number;
  rejected: RejectionReport;
  durationMs: number;
};
