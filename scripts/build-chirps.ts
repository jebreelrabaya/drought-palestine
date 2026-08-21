/**
 * Precomputes per-city monthly rainfall totals from CHIRPS and writes them to
 * server/data/chirps-monthly.json.
 *
 * The monthly and annual views read that file instead of touching the network,
 * because covering every rainy season on demand would mean ~260 raster reads
 * per request. Re-run this when new CHIRPS months are published:
 *   pnpm run build:chirps
 *
 * Two sources, in the project's required order of preference:
 *   1. CHIRPS v3.0 rasters straight from data.chc.ucsb.edu (one file per
 *      month, all cities read from it).
 *   2. CHIRPS v2.0 via ClimateSERV, used only when CHC is unreachable. CHC
 *      answers 403 for hours once its rate limit is tripped, and ClimateSERV
 *      is separate infrastructure, so this keeps the backfill possible.
 *
 * The run is resumable and self-upgrading: months already stored as v3.0 are
 * skipped, and months stored as v2.0 are retried against v3.0 whenever CHC is
 * reachable again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PALESTINIAN_CITIES } from "../server/cities";
import { monthlyUrl, readPointsWithFallback, type ChirpsVersion } from "../server/chirps";
import { fetchMonthlyTotals } from "../server/climateserv";
import { fetchMonthlyTotals as fetchNasaMonthlyTotals } from "../server/nasa";

const FIRST_YEAR = 2000;
// CHC rate-limits with 403 once you hit it hard, so stay gentle and back off.
const CONCURRENCY = 3;
const RETRIES = 4;
const BASE_BACKOFF_MS = 4000;
const OUT = path.resolve(import.meta.dirname, "..", "server", "data", "chirps-monthly.json");

const points = PALESTINIAN_CITIES.map(city => ({
  id: city.id,
  longitude: city.longitude,
  latitude: city.latitude,
}));

type DataVersion = ChirpsVersion | "nasa";
type MonthEntry = {
  version: DataVersion;
  values: Record<string, number | null>;
  sources?: Record<string, DataVersion>;
};
type Dataset = {
  generatedAt: string;
  product: string;
  cities: string[];
  months: Record<string, MonthEntry>;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

function monthsToBuild() {
  const now = new Date();
  const months: { year: number; month: number; key: string }[] = [];
  for (let year = FIRST_YEAR; year <= now.getUTCFullYear(); year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === now.getUTCFullYear() && month > now.getUTCMonth() + 1) break;
      months.push({ year, month, key: monthKey(year, month) });
    }
  }
  return months;
}

async function chcReachable() {
  try {
    const response = await fetch(monthlyUrl("3.0", 2015, 6), { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function buildMonthFromChc(year: number, month: number): Promise<MonthEntry | null> {
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

async function backfillFromChc(months: Record<string, MonthEntry>, targets: ReturnType<typeof monthsToBuild>) {
  let done = 0;
  for (let index = 0; index < targets.length; index += CONCURRENCY) {
    const batch = targets.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map(t => buildMonthFromChc(t.year, t.month)));
    batch.forEach((target, offset) => {
      done++;
      const entry = results[offset];
      if (entry) months[target.key] = entry;
    });
    process.stdout.write(`\r  CHC v3: ${done}/${targets.length} months`);
    await sleep(250);
  }
  process.stdout.write("\n");
}

async function backfillFromClimateServ(
  months: Record<string, MonthEntry>,
  targets: ReturnType<typeof monthsToBuild>
) {
  const wanted = new Set(targets.map(t => t.key));
  const start = `${FIRST_YEAR}-01-01`;
  const end = new Date().toISOString().slice(0, 10);

  for (const [index, city] of PALESTINIAN_CITIES.entries()) {
    process.stdout.write(`\r  ClimateSERV v2: ${index + 1}/${PALESTINIAN_CITIES.length} ${city.id}          `);
    let totals: Record<string, number>;
    try {
      totals = await fetchMonthlyTotals(city.longitude, city.latitude, start, end);
    } catch (error) {
      console.warn(`\n  ${city.id} failed: ${(error as Error).message}`);
      continue;
    }
    for (const [key, value] of Object.entries(totals)) {
      if (!wanted.has(key)) continue;
      const entry = months[key] ?? { version: "2.0" as DataVersion, values: {} };
      // Never let a v2 reading overwrite a v3 one for the same city/month.
      if (entry.version === "3.0" && entry.values[city.id] !== undefined) continue;
      entry.version = entry.version === "3.0" ? "3.0" : "2.0";
      entry.values[city.id] = value;
      months[key] = entry;
    }
  }
  process.stdout.write("\n");
}

/**
 * Last resort. Fills city/month cells that neither CHIRPS version could cover
 * and marks them as NASA-sourced so the UI never calls them CHIRPS. Currently
 * this is only Jericho, whose cell is masked in the CHIRPS 2.0 grid.
 */
async function backfillFromNasa(months: Record<string, MonthEntry>, targets: ReturnType<typeof monthsToBuild>) {
  const gaps = PALESTINIAN_CITIES.filter(city =>
    targets.some(target => months[target.key]?.values[city.id] == null)
  );
  if (!gaps.length) return;
  console.log(`  NASA POWER last resort for: ${gaps.map(c => c.id).join(", ")}`);

  const start = `${FIRST_YEAR}-01-01`;
  const end = new Date().toISOString().slice(0, 10);
  for (const city of gaps) {
    let totals: Record<string, number>;
    try {
      totals = await fetchNasaMonthlyTotals(city.longitude, city.latitude, start, end);
    } catch (error) {
      console.warn(`  ${city.id} NASA fetch failed: ${(error as Error).message}`);
      continue;
    }
    let filled = 0;
    for (const target of targets) {
      const entry = months[target.key];
      if (!entry || entry.values[city.id] != null) continue;
      const value = totals[target.key];
      if (value === undefined) continue;
      entry.values[city.id] = value;
      entry.sources = { ...(entry.sources ?? {}), [city.id]: "nasa" };
      filled++;
    }
    console.log(`    ${city.id}: filled ${filled} months from NASA POWER`);
  }
}

async function main() {
  const all = monthsToBuild();
  const existing: Dataset | null = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const months: Record<string, MonthEntry> = existing?.months ?? {};

  const reachable = await chcReachable();
  console.log(`${all.length} months wanted, ${Object.keys(months).length} already stored`);
  console.log(`CHC v3 reachable: ${reachable ? "yes" : "no (falling back to ClimateSERV v2)"}`);

  if (reachable) {
    // Fetch what is missing, and re-try anything currently held at v2.0.
    const targets = all.filter(t => !months[t.key] || months[t.key].version === "2.0");
    console.log(`  ${targets.length} months to fetch or upgrade`);
    if (targets.length) await backfillFromChc(months, targets);
  } else {
    // Any month that is absent, or present but missing a city, is a target.
    const targets = all.filter(
      t => !months[t.key] || PALESTINIAN_CITIES.some(c => months[t.key].values[c.id] === undefined)
    );
    console.log(`  ${targets.length} months incomplete`);
    if (targets.length) await backfillFromClimateServ(months, targets);
  }

  // Anything CHIRPS still cannot cover falls back to NASA POWER, per city.
  await backfillFromNasa(months, all);

  const versions: Record<string, number> = {};
  for (const entry of Object.values(months)) versions[entry.version] = (versions[entry.version] ?? 0) + 1;

  const ordered = Object.fromEntries(Object.entries(months).sort(([a], [b]) => a.localeCompare(b)));
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        product: "CHIRPS monthly global 0.05°",
        cities: PALESTINIAN_CITIES.map(c => c.id),
        months: ordered,
      },
      null,
      0
    )}\n`
  );
  let nasaCells = 0;
  for (const entry of Object.values(months)) {
    nasaCells += Object.values(entry.sources ?? {}).filter(v => v === "nasa").length;
  }
  const keys = Object.keys(ordered);
  console.log(
    `wrote ${keys.length} months (${keys[0]} .. ${keys.at(-1)}) ` +
      `v3=${versions["3.0"] ?? 0} v2=${versions["2.0"] ?? 0} nasa-cells=${nasaCells}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
