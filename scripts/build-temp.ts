/**
 * Precomputes per-city monthly temperature (mean/max/min, °C) from NASA POWER
 * and writes them to server/data/temp-monthly.json.
 *
 * Temperature feeds the SPEI drought index (via Thornthwaite PET) and the
 * temperature stat card. CHIRPS carries no temperature, so this is NASA POWER
 * only — a reanalysis product, labelled as such in the UI. Re-run when new
 * months are published:
 *   pnpm run build:temp
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PALESTINIAN_CITIES } from "../server/cities";

const FIRST_YEAR = 2000;
// The monthly API rejects the current (incomplete) year, so read daily values
// and aggregate — this reaches near-present and keeps the current season covered.
const POWER_DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
const OUT = path.resolve(import.meta.dirname, "..", "server", "data", "temp-monthly.json");

type TempField = "t2m" | "tmax" | "tmin";
type MonthEntry = { t2m: Record<string, number | null>; tmax: Record<string, number | null>; tmin: Record<string, number | null> };

const PARAM: Record<TempField, string> = { t2m: "T2M", tmax: "T2M_MAX", tmin: "T2M_MIN" };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Daily T2M/T2M_MAX/T2M_MIN for a city, averaged into monthly means. */
async function fetchCityMonthly(longitude: number, latitude: number, end: string) {
  const query = new URLSearchParams({
    parameters: "T2M,T2M_MAX,T2M_MIN",
    community: "RE",
    longitude: String(longitude),
    latitude: String(latitude),
    start: `${FIRST_YEAR}0101`,
    end: end.replaceAll("-", ""),
    format: "JSON",
    "time-standard": "UTC",
  });
  const response = await fetch(`${POWER_DAILY_URL}?${query}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`NASA POWER responded ${response.status}`);
  const payload = (await response.json()) as {
    properties?: { parameter?: Record<string, Record<string, number>> };
  };
  const params = payload.properties?.parameter;
  if (!params) throw new Error("NASA POWER returned no parameters");

  // field -> "YYYY-MM" -> {sum, count} of valid days
  const acc: Record<TempField, Record<string, { sum: number; count: number }>> = { t2m: {}, tmax: {}, tmin: {} };
  for (const [field, powerKey] of Object.entries(PARAM) as [TempField, string][]) {
    for (const [key, raw] of Object.entries(params[powerKey] ?? {})) {
      if (!Number.isFinite(raw) || raw <= -900) continue; // POWER uses -999 for missing
      const period = `${key.slice(0, 4)}-${key.slice(4, 6)}`;
      const bucket = (acc[field][period] ??= { sum: 0, count: 0 });
      bucket.sum += raw;
      bucket.count += 1;
    }
  }
  return acc;
}

async function main() {
  const end = new Date().toISOString().slice(0, 10);
  const months: Record<string, MonthEntry> = {};

  for (const [index, city] of PALESTINIAN_CITIES.entries()) {
    process.stdout.write(`\r  ${index + 1}/${PALESTINIAN_CITIES.length} ${city.id}          `);
    let acc;
    try {
      acc = await fetchCityMonthly(city.longitude, city.latitude, end);
    } catch (error) {
      console.warn(`\n  ${city.id} failed: ${(error as Error).message}`);
      continue;
    }
    for (const field of Object.keys(PARAM) as TempField[]) {
      for (const [period, bucket] of Object.entries(acc[field])) {
        const entry = (months[period] ??= { t2m: {}, tmax: {}, tmin: {} });
        entry[field][city.id] = bucket.count ? round2(bucket.sum / bucket.count) : null;
      }
    }
    await sleep(300);
  }
  process.stdout.write("\n");

  const ordered = Object.fromEntries(Object.entries(months).sort(([a], [b]) => a.localeCompare(b)));
  if (!existsSync(path.dirname(OUT))) mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        product: "NASA POWER monthly temperature (T2M/T2M_MAX/T2M_MIN, °C)",
        cities: PALESTINIAN_CITIES.map(c => c.id),
        months: ordered,
      },
      null,
      0
    )}\n`
  );
  const keys = Object.keys(ordered);
  console.log(`wrote ${keys.length} months (${keys[0]} .. ${keys.at(-1)})`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
