/**
 * Overture release resolution.
 *
 * Overture publishes dated, immutable snapshots ("2026-07-22.0"). Pinning one
 * makes an import reproducible; resolving "latest" from their STAC catalogue
 * keeps a scheduled re-import current. Nothing here is country-specific.
 */

const STAC_CATALOG_URL = 'https://stac.overturemaps.org/';
const RELEASE_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Last-resort release, used only when the STAC catalogue is unreachable and no
 * release was configured. Verified to exist; bump occasionally.
 */
export const FALLBACK_RELEASE = '2026-07-22.0';

type StacCatalog = {
  latest?: string;
  links?: Array<{ rel?: string; href?: string; latest?: boolean }>;
};

async function fetchLatestRelease(): Promise<string | null> {
  try {
    const res = await fetch(STAC_CATALOG_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const catalog = (await res.json()) as StacCatalog;

    if (typeof catalog.latest === 'string' && RELEASE_RE.test(catalog.latest)) {
      return catalog.latest;
    }

    const children = (catalog.links ?? []).filter((l) => l.rel === 'child');
    const candidates = children
      .map((l) => ({
        id: String(l.href ?? '')
          .replace(/^\.\//, '')
          .split('/')[0],
        flagged: l.latest === true,
      }))
      .filter((c) => RELEASE_RE.test(c.id));

    if (candidates.length === 0) return null;

    const flagged = candidates.find((c) => c.flagged);
    if (flagged) return flagged.id;

    // Release ids sort lexicographically in chronological order.
    return candidates.map((c) => c.id).sort().pop() ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve which Overture release to read.
 *
 * Precedence: explicit argument, then OVERTURE_RELEASE, then the STAC
 * catalogue's latest, then FALLBACK_RELEASE. In the first two, the literal
 * "latest" (any case) means "go ask the catalogue".
 */
export async function resolveRelease(explicit?: string | null): Promise<string> {
  const configured = explicit ?? process.env.OVERTURE_RELEASE ?? null;

  if (configured && configured.trim().toLowerCase() !== 'latest') {
    const value = configured.trim();
    if (!RELEASE_RE.test(value)) {
      throw new Error(
        `Invalid Overture release "${value}" — expected a form like 2026-07-22.0`,
      );
    }
    return value;
  }

  return (await fetchLatestRelease()) ?? FALLBACK_RELEASE;
}
