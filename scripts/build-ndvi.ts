/**
 * Precomputes per-city monthly MODIS NDVI (vegetation greenness) and writes
 * server/data/ndvi-monthly.json.
 *
 * Source: NASA AppEEARS point service (MOD13Q1.061, 250m 16-day NDVI). AppEEARS
 * is async — submit a point task, poll, download — so it can only run offline,
 * never per request. A GitHub Action runs this on a monthly cron; MODIS NDVI is
 * a 16-day composite, so that keeps the file as fresh as the product itself.
 *
 * Auth (Earthdata Login), from env:
 *   EARTHDATA_TOKEN                    (an AppEEARS/EDL bearer token), or
 *   EARTHDATA_USERNAME + EARTHDATA_PASSWORD  (used against AppEEARS /login)
 *
 *   pnpm run build:ndvi
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PALESTINIAN_CITIES } from "../server/cities";

const API = "https://appeears.earthdatacloud.nasa.gov/api";
const PRODUCT = "MOD13Q1.061";
const LAYER = "_250m_16_days_NDVI";
const RELIABILITY_LAYER = "_250m_16_days_pixel_reliability";
// MOD13Q1 has no per-pixel cloud percentage; pixel reliability is the accuracy
// control: 0 good, 1 marginal, 2 snow/ice, 3 cloudy, -1 fill. Keep only clear
// (good/marginal) composites so cloud-contaminated readings never enter a month.
const MAX_RELIABILITY = 1;
const FIRST_DATE = "01-01-2000"; // MM-DD-YYYY; MOD13Q1 begins 2000-02-18
const OUT = path.resolve(import.meta.dirname, "..", "server", "data", "ndvi-monthly.json");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Node fetch has no default timeout, so a stalled AppEEARS connection would hang
// the whole job indefinitely. Bound every request.
async function fetchT(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function authToken(): Promise<string> {
  if (process.env.EARTHDATA_TOKEN) return process.env.EARTHDATA_TOKEN;
  const user = process.env.EARTHDATA_USERNAME;
  const pass = process.env.EARTHDATA_PASSWORD;
  if (!user || !pass) {
    throw new Error("Set EARTHDATA_TOKEN, or EARTHDATA_USERNAME + EARTHDATA_PASSWORD.");
  }
  const basic = Buffer.from(`${user}:${pass}`).toString("base64");
  const response = await fetchT(`${API}/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!response.ok) throw new Error(`AppEEARS login failed: ${response.status}`);
  const { token } = (await response.json()) as { token?: string };
  if (!token) throw new Error("AppEEARS login returned no token");
  return token;
}

async function submitTask(token: string, endDate: string): Promise<string> {
  const body = {
    task_type: "point",
    task_name: `palestine-ndvi-${Date.now()}`,
    params: {
      dates: [{ startDate: FIRST_DATE, endDate }],
      layers: [
        { product: PRODUCT, layer: LAYER },
        { product: PRODUCT, layer: RELIABILITY_LAYER },
      ],
      coordinates: PALESTINIAN_CITIES.map(city => ({
        latitude: city.latitude,
        longitude: city.longitude,
        id: city.id,
        category: city.id,
      })),
    },
  };
  const response = await fetchT(`${API}/task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`AppEEARS task submit failed: ${response.status} ${await response.text()}`);
  const { task_id } = (await response.json()) as { task_id?: string };
  if (!task_id) throw new Error("AppEEARS returned no task_id");
  return task_id;
}

async function waitForTask(token: string, taskId: string, timeoutMs = 40 * 60_000) {
  const start = Date.now();
  const deadline = start + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetchT(`${API}/task/${taskId}`, { headers: { Authorization: `Bearer ${token}` } }, 30_000);
      const status = (await response.json()) as { status?: string };
      last = status.status ?? "?";
      process.stdout.write(`\r  task ${taskId}: ${last} (${Math.round((Date.now() - start) / 60000)}m)          `);
      if (last === "done") return;
      if (last === "error") throw new Error("AppEEARS task errored");
    } catch (error) {
      if (error instanceof Error && error.message.includes("errored")) throw error;
      // A stalled/aborted poll must not kill the job; keep trying until the deadline.
      process.stdout.write(`\r  poll retry after ${(error as Error).name}          `);
    }
    await sleep(20_000);
  }
  throw new Error(`AppEEARS task did not finish within ${Math.round(timeoutMs / 60_000)} min (last status: ${last || "none"})`);
}

/** Locate and download the NDVI results CSV from the finished task bundle. */
async function fetchResultsCsv(token: string, taskId: string): Promise<string> {
  const bundle = (await (await fetchT(`${API}/bundle/${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json()) as { files?: { file_id: string; file_name: string }[] };
  const csv = bundle.files?.find(f => f.file_name.endsWith(".csv") && /NDVI|results/i.test(f.file_name))
    ?? bundle.files?.find(f => f.file_name.endsWith(".csv"));
  if (!csv) throw new Error("No results CSV in AppEEARS bundle");
  const response = await fetchT(`${API}/bundle/${taskId}/${csv.file_id}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, 120_000);
  if (!response.ok) throw new Error(`Bundle download failed: ${response.status}`);
  return response.text();
}

type MonthAgg = Record<string, { sum: number; count: number }>; // "YYYY-MM" -> agg (per city)

/** Averages the 16-day composites into monthly NDVI per city. */
function aggregate(csv: string): Record<string, MonthAgg> {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0].split(",").map(h => h.trim());
  const idIdx = header.findIndex(h => /^ID$/i.test(h));
  const catIdx = header.findIndex(h => /^Category$/i.test(h));
  const dateIdx = header.findIndex(h => /^Date$/i.test(h));
  const ndviIdx = header.findIndex(h => h.includes("250m_16_days_NDVI") && !/QA|Quality|Reliability/i.test(h));
  const reliaIdx = header.findIndex(h => /pixel_reliability/i.test(h));
  if (dateIdx < 0 || ndviIdx < 0) throw new Error(`Unexpected AppEEARS CSV header: ${header.join("|")}`);
  const keyIdx = catIdx >= 0 ? catIdx : idIdx;

  const byCity: Record<string, MonthAgg> = {};
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const cityId = (cols[keyIdx] ?? "").trim();
    const date = (cols[dateIdx] ?? "").trim(); // AppEEARS emits YYYY-MM-DD
    let value = Number(cols[ndviIdx]);
    if (!cityId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) continue;
    // Cloud/quality screen: only clear (good/marginal) composites.
    const reliability = reliaIdx >= 0 ? Number(cols[reliaIdx]) : 0;
    if (!Number.isFinite(reliability) || reliability < 0 || reliability > MAX_RELIABILITY) continue;
    if (Math.abs(value) > 1.5) value /= 10000; // raw DN (×10000) rather than scaled
    if (value < -0.2 || value > 1) continue; // drop fill / out-of-range composites
    const period = date.slice(0, 7);
    const agg = (byCity[cityId] ??= {});
    const bucket = (agg[period] ??= { sum: 0, count: 0 });
    bucket.sum += value;
    bucket.count += 1;
  }
  return byCity;
}

async function main() {
  const token = await authToken();
  const endDate = (() => {
    const [y, m, d] = new Date().toISOString().slice(0, 10).split("-");
    return `${m}-${d}-${y}`;
  })();

  console.log(`Submitting AppEEARS point task (${PRODUCT} ${LAYER}) for ${PALESTINIAN_CITIES.length} cities…`);
  const taskId = await submitTask(token, endDate);
  await waitForTask(token, taskId);
  process.stdout.write("\n");
  const csv = await fetchResultsCsv(token, taskId);
  const byCity = aggregate(csv);

  // Reshape city -> month into month -> {city: ndvi}.
  const months: Record<string, Record<string, number | null>> = {};
  for (const [cityId, agg] of Object.entries(byCity)) {
    for (const [period, bucket] of Object.entries(agg)) {
      (months[period] ??= {})[cityId] = bucket.count ? Math.round((bucket.sum / bucket.count) * 1000) / 1000 : null;
    }
  }
  const ordered = Object.fromEntries(Object.entries(months).sort(([a], [b]) => a.localeCompare(b)));

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        product: "MODIS MOD13Q1.061 250m 16-day NDVI (monthly mean, clear composites only)",
        cities: PALESTINIAN_CITIES.map(c => c.id),
        months: ordered,
      },
      null,
      0
    )}\n`
  );
  const keys = Object.keys(ordered);
  console.log(`wrote ${keys.length} months (${keys[0] ?? "—"} .. ${keys.at(-1) ?? "—"})`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
