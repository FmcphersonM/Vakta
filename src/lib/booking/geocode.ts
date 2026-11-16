/**
 * Norwegian address lookup via Kartverket's free address API (no key needed).
 * https://ws.geonorge.no/adresser/v1/  — used to normalise addresses and get
 * coordinates for travel-time estimates and service-area checks.
 */
export type GeoResult = { address: string; lat: number; lng: number; postcode: string; city: string };

const cache = new Map<string, { at: number; value: GeoResult | null }>();
const TTL = 24 * 3600_000;

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
}

type GeonorgeAddress = {
  adressetekst: string;
  postnummer: string;
  poststed: string;
  representasjonspunkt?: { lat: number; lon: number };
};

let fetcher: typeof fetch = (...a) => fetch(...a);
/** Tests replace the network call. */
export function setGeocodeFetchForTests(f: typeof fetch | null) {
  fetcher = f ?? ((...a) => fetch(...a));
  cache.clear();
}

export async function geocodeAddress(input: string, timeoutMs = 3000): Promise<GeoResult | null> {
  const q = input.replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 3) return null;
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const url = new URL("https://ws.geonorge.no/adresser/v1/sok");
  url.searchParams.set("sok", q);
  url.searchParams.set("fuzzy", "true");
  url.searchParams.set("treffPerSide", "1");
  url.searchParams.set("utkoordsys", "4258");
  let value: GeoResult | null = null;
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (res.ok) {
      const data = (await res.json()) as { adresser?: GeonorgeAddress[] };
      const a = data.adresser?.[0];
      if (a?.representasjonspunkt) {
        const city = titleCase(a.poststed);
        value = {
          address: `${a.adressetekst}, ${a.postnummer} ${city}`,
          lat: a.representasjonspunkt.lat,
          lng: a.representasjonspunkt.lon,
          postcode: a.postnummer,
          city,
        };
      }
    }
  } catch (e) {
    console.warn("[geocode] lookup failed", e instanceof Error ? e.message : e);
    return null; // don't cache failures
  }
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return value;
}
