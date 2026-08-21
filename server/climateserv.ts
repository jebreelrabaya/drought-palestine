/**
 * ClimateSERV (SERVIR) serves CHIRPS from infrastructure separate from
 * data.chc.ucsb.edu, which matters because CHC rate-limits hard and answers
 * 403 for hours once tripped. It exposes CHIRPS 2.0 only, so this is the
 * v2.0 fallback path, never the v3.0 primary.
 *
 * It extracts server-side over a polygon and returns a whole daily series in
 * one job, so a full record costs two jobs per city instead of ~9,700 raster
 * reads.
 */
const BASE = "https://climateserv.servirglobal.net/api";
/** CHIRPS rainfall. */
const DATATYPE_CHIRPS = 0;
const INTERVAL_DAILY = 0;
const OPERATION_AVERAGE = 5;
/** ClimateSERV rejects anything wider than this. */
const MAX_YEARS_PER_REQUEST = 20;

export type DailyValue = { date: string; precipitationMm: number };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Half-width of the sampling box, small enough to sit inside a single CHIRPS
 * 0.05 deg pixel. Widening it is NOT an acceptable way to work around a masked
 * cell: ClimateSERV then averages whatever neighbours are valid, and for
 * Jericho that pulls in the Judean highlands and reports 135.94mm for Jan 2015
 * against roughly 28mm of truth. A masked cell must come back empty instead.
 */
const BOX_HALF = 0.004;

function pixelBox(longitude: number, latitude: number, half: number) {
  const ring = [
    [longitude - half, latitude - half],
    [longitude + half, latitude - half],
    [longitude + half, latitude + half],
    [longitude - half, latitude + half],
    [longitude - half, latitude - half],
  ];
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

const usDate = (iso: string) => {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
};

async function submit(geometry: string, start: string, end: string): Promise<string> {
  const query = new URLSearchParams({
    datatype: String(DATATYPE_CHIRPS),
    begintime: usDate(start),
    endtime: usDate(end),
    intervaltype: String(INTERVAL_DAILY),
    operationtype: String(OPERATION_AVERAGE),
    geometry,
  });
  const response = await fetch(`${BASE}/submitDataRequest/?${query}`);
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`ClimateSERV rejected the request: ${text.slice(0, 120)}`);
  }
  const id = Array.isArray(parsed) ? String(parsed[0]) : "";
  if (!id) throw new Error(`ClimateSERV returned no job id: ${text.slice(0, 120)}`);
  return id;
}

async function waitForJob(id: string, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/getDataRequestProgress/?id=${id}`);
    const text = (await response.text()).trim();
    if (text.includes("100")) return;
    // A negative progress value is ClimateSERV reporting a failed job.
    if (text.includes("-")) throw new Error(`ClimateSERV job ${id} failed: ${text}`);
    await sleep(5000);
  }
  throw new Error(`ClimateSERV job ${id} timed out`);
}

type RawRecord = { isodate?: string; raw_value?: number };

async function collect(id: string): Promise<DailyValue[]> {
  const response = await fetch(`${BASE}/getDataFromRequest/?id=${id}`);
  const payload = (await response.json()) as { data?: RawRecord[] };
  const values: DailyValue[] = [];
  for (const record of payload.data ?? []) {
    const value = Number(record.raw_value);
    // ClimateSERV reports missing pixels as a large negative sentinel.
    if (!record.isodate || !Number.isFinite(value) || value < 0) continue;
    const [month, day, year] = record.isodate.split("/");
    values.push({ date: `${year}-${month}-${day}`, precipitationMm: value });
  }
  return values.sort((left, right) => left.date.localeCompare(right.date));
}

/** Splits the span into <=20 year windows, which is ClimateSERV's hard limit. */
function windows(start: string, end: string) {
  const spans: { start: string; end: string }[] = [];
  let cursor = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  while (cursor <= lastYear) {
    const windowEndYear = Math.min(cursor + MAX_YEARS_PER_REQUEST - 1, lastYear);
    spans.push({
      start: cursor === Number(start.slice(0, 4)) ? start : `${cursor}-01-01`,
      end: windowEndYear === lastYear ? end : `${windowEndYear}-12-31`,
    });
    cursor = windowEndYear + 1;
  }
  return spans;
}

export async function fetchDailySeries(
  longitude: number,
  latitude: number,
  start: string,
  end: string
): Promise<DailyValue[]> {
  const geometry = pixelBox(longitude, latitude, BOX_HALF);
  const all: DailyValue[] = [];
  for (const span of windows(start, end)) {
    const id = await submit(geometry, span.start, span.end);
    await waitForJob(id);
    all.push(...(await collect(id)));
  }
  return all.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Monthly totals summed from the daily series. ClimateSERV occasionally
 * collapses a month's daily breakdown onto its first day, but the month's
 * total is preserved, so summing to months stays correct either way.
 */
export async function fetchMonthlyTotals(
  longitude: number,
  latitude: number,
  start: string,
  end: string
): Promise<Record<string, number>> {
  const daily = await fetchDailySeries(longitude, latitude, start, end);
  const months: Record<string, number> = {};
  for (const value of daily) {
    const key = value.date.slice(0, 7);
    months[key] = (months[key] ?? 0) + value.precipitationMm;
  }
  for (const key of Object.keys(months)) {
    months[key] = Math.round(months[key] * 100) / 100;
  }
  return months;
}
