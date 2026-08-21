/**
 * Precomputes per-city monthly rainfall totals from CHIRPS and writes them to
 * server/data/chirps-monthly.json.
 *
 * The monthly and annual views read that file instead of touching the network,
 * because covering every rainy season on demand would mean ~260 raster reads
 * per request. Re-run this when new CHIRPS months are published:
 *   pnpm run build:chirps
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PALESTINIAN_CITIES } from "../server/cities";
import { monthlyUrl, readPointsWithFallback, type ChirpsVersion } from "../server/chirps";

const FIRST_YEAR = 2000;
// CHC rate-limits with 403 once you hit it hard, so stay gentle and back off.
const CONCURRENCY = 3;
const RETRIES = 5;
const BASE_BACKOFF_MS = 4000;
const OUT = path.resolve(import.meta.dirname, "..", "server", "data", "chirps-monthly.json");

const points = PALESTINIAN_CITIES.map(city => ({
  id: city.id,
  longitude: city.longitude,
  latitude: city.latitude,
}));

type MonthEntry = { version: ChirpsVersion; values: Record<string, number | null> };

function monthsToBuild() {
  const now = new Date();
  const months: { year: number; month: number; key: string }[] = [];
  for (let year = FIRST_YEAR; year <= now.getUTCFullYear(); year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === now.getUTCFullYear() && month > now.getUTCMonth() + 1) break;
      months.push({ year, month, key: `${year}-${String(month).padStart(2, "0")}` });
    }
  }
  return months;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function buildMonth(year: number, month: number): Promise<MonthEntry | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const { version, samples } = await readPointsWithFallback(v => monthlyUrl(v, year, month), points);
      const values: Record<string, number | null> = {};
      for (const sample of samples) {
        values[sample.id] =
          sample.precipitationMm === null ? null : Math.round(sample.precipitationMm * 100) / 100;
      }
      return { version, values };
    } catch {
      // A 403 here is throttling, not absence, so wait longer each time.
      if (attempt < RETRIES) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    }
  }
  return null; // month not published yet, or unreachable in both versions
}

async function main() {
  const all = monthsToBuild();
  // Resume: keep whatever a previous run already fetched so a throttled run
  // can simply be re-run until it completes.
  const months: Record<string, MonthEntry> =
    existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")).months ?? {}) : {};
  const targets = all.filter(t => !months[t.key]);
  console.log(`${all.length} months total, ${targets.length} to fetch`);
  let done = 0;
  let missing = 0;
  const counts: Record<string, number> = { "3.0": 0, "2.0": 0 };

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(t => buildMonth(t.year, t.month)));
    await sleep(250);
    batch.forEach((target, index) => {
      const entry = results[index];
      done++;
      if (!entry) {
        missing++;
        return;
      }
      months[target.key] = entry;
      counts[entry.version]++;
    });
    process.stdout.write(`\r${done}/${targets.length} months  v3=${counts["3.0"]} v2=${counts["2.0"]} missing=${missing}   `);
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        product: "CHIRPS monthly global 0.05°",
        cities: PALESTINIAN_CITIES.map(c => c.id),
        months,
      },
      null,
      0
    )}\n`
  );
  console.log(`\nwrote ${OUT} (${Object.keys(months).length} months)`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
