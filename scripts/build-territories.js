#!/usr/bin/env node
/**
 * Builds the territory reference file behind the editor's territory selectors
 * (`GET /v2/territories/:country`) from Overture Maps divisions.
 *
 *   node scripts/build-territories.js [--release 2026-07-22.0]
 *
 * Output: libs/shared/src/modules/territory/data/us.json
 *
 * A territory is keyed by its Overture *division_area* GERS id — the same id
 * `yarn overture:import --division` takes — so a county picked in the editor
 * and the same county imported by the CLI end up with the same territory code
 * (see territory-code.util.ts). No FIPS or any other national code system is
 * involved: the hierarchy comes from Overture's own `parent_division_id`.
 *
 * Only divisions that have a land boundary polygon are kept. Overture lists
 * ~140k US localities, but most are bare points (hamlets, neighbourhood
 * labels); without a polygon the importer has nothing to intersect against.
 *
 * Reads Overture's public S3 bucket, so it needs outbound internet and takes
 * about a minute. Re-run when bumping the Overture release.
 */
const { writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');

const S3_ROOT = 's3://overturemaps-us-west-2/release';
const DEFAULT_RELEASE = '2026-07-22.0';
const RELEASE_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;

// The US profile. Adding a country means adding an entry here, a level list in
// the frontend's catalogs, and nothing else.
const COUNTRIES = {
  us: {
    iso: 'US',
    // Overture subtype per selector level, largest first.
    levels: [
      { key: 'state', subtype: 'region' },
      { key: 'county', subtype: 'county' },
      { key: 'place', subtype: 'locality' },
    ],
  },
};

// 4 decimals ≈ 11 m. Rounded outward so the box still contains the polygon.
const floor4 = (n) => Math.floor(n * 1e4) / 1e4;
const ceil4 = (n) => Math.ceil(n * 1e4) / 1e4;

async function main() {
  const { values } = parseArgs({
    options: {
      release: { type: 'string', default: DEFAULT_RELEASE },
      country: { type: 'string', default: 'us' },
    },
  });
  const release = values.release;
  if (!RELEASE_RE.test(release)) {
    throw new Error(`Invalid Overture release "${release}"`);
  }
  const profile = COUNTRIES[values.country];
  if (!profile) {
    throw new Error(`No territory profile for country "${values.country}"`);
  }

  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(':memory:');
  const con = await instance.connect();
  await con.run('INSTALL httpfs; LOAD httpfs;');
  await con.run("SET s3_region='us-west-2';");

  const subtypes = profile.levels.map((l) => `'${l.subtype}'`).join(',');
  const divisions = `${S3_ROOT}/${release}/theme=divisions/type=division/*`;
  const areas = `${S3_ROOT}/${release}/theme=divisions/type=division_area/*`;

  console.log(`Overture release ${release} — scanning divisions…`);
  const started = Date.now();
  const rows = (
    await con.runAndReadAll(`
      WITH d AS (
        SELECT id, names.primary AS name, subtype, parent_division_id
        FROM read_parquet('${divisions}', hive_partitioning=1)
        WHERE country = '${profile.iso}' AND subtype IN (${subtypes})
          AND names.primary IS NOT NULL
      ),
      a AS (
        SELECT division_id, id AS area_id,
               (bbox).xmin AS xmin, (bbox).ymin AS ymin,
               (bbox).xmax AS xmax, (bbox).ymax AS ymax
        FROM read_parquet('${areas}', hive_partitioning=1)
        WHERE country = '${profile.iso}' AND subtype IN (${subtypes})
          AND class = 'land'
      )
      SELECT d.id, d.name, d.subtype, d.parent_division_id,
             a.area_id, a.xmin, a.ymin, a.xmax, a.ymax
      FROM d JOIN a ON a.division_id = d.id`)
  ).getRowObjects();
  console.log(
    `${rows.length} divisions with a land polygon, in ${(
      (Date.now() - started) /
      1000
    ).toFixed(0)}s`,
  );

  // Nest by Overture's parent_division_id, level by level. A division whose
  // parent is not at the level directly above (a locality under another
  // locality, say) is dropped: the selectors are a strict chain.
  const byDivisionId = new Map();
  for (const r of rows) {
    byDivisionId.set(String(r.id), {
      node: [
        String(r.area_id),
        String(r.name),
        [floor4(r.xmin), floor4(r.ymin), ceil4(r.xmax), ceil4(r.ymax)],
      ],
      subtype: String(r.subtype),
      parent: r.parent_division_id ? String(r.parent_division_id) : null,
      children: [],
    });
  }

  const [top, ...below] = profile.levels;
  const roots = [];
  const dropped = {};
  for (const entry of byDivisionId.values()) {
    if (entry.subtype === top.subtype) {
      roots.push(entry);
      continue;
    }
    const levelIndex = below.findIndex((l) => l.subtype === entry.subtype);
    const expectedParent = profile.levels[levelIndex].subtype;
    const parent = byDivisionId.get(entry.parent);
    if (parent && parent.subtype === expectedParent) {
      parent.children.push(entry);
    } else {
      dropped[entry.subtype] = (dropped[entry.subtype] || 0) + 1;
    }
  }

  const byName = (a, b) => a.node[1].localeCompare(b.node[1], 'en');
  const serialize = (entry) => {
    entry.children.sort(byName);
    return entry.children.length
      ? [...entry.node, entry.children.map(serialize)]
      : entry.node;
  };
  roots.sort(byName);

  // Territory codes use only the first 8 hex digits of the id, so a collision
  // would make two territories indistinguishable. Refuse to write one.
  const prefixes = new Map();
  for (const { node } of byDivisionId.values()) {
    const prefix = node[0].replace(/-/g, '').slice(0, 8);
    if (prefixes.has(prefix)) {
      throw new Error(
        `Territory code collision on ${prefix}: ${prefixes.get(prefix)} / ${
          node[1]
        }`,
      );
    }
    prefixes.set(prefix, node[1]);
  }

  const output = {
    country: values.country,
    source: `Overture Maps divisions, release ${release}`,
    levels: profile.levels.map((l) => l.key),
    // Each node: [divisionAreaId, name, [xmin, ymin, xmax, ymax], children?]
    territories: roots.map(serialize),
  };

  const outFile = path.join(
    __dirname,
    '..',
    'libs/shared/src/modules/territory/data',
    `${values.country}.json`,
  );
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(output));

  const kept = roots.reduce(function count(n, e) {
    return n + 1 + e.children.reduce(count, 0);
  }, 0);
  console.log(
    `Wrote ${kept} territories to ${path.relative(process.cwd(), outFile)}`,
  );
  if (Object.keys(dropped).length) {
    console.log('Dropped (parent not at the level above):', dropped);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
