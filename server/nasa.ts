/**
 * NASA POWER is the last-resort source, used ONLY where CHIRPS has no coverage
 * at all. Today that is Jericho: it sits in the Dead Sea rift, which is masked
 * in the CHIRPS 2.0 grid ClimateSERV serves, so the only CHIRPS reading for it
 * comes from the v3.0 rasters on data.chc.ucsb.edu.
 *
 * Checked against CHIRPS v3.0 for Jericho over 59 overlapping months: 1254.6mm
 * against 1175.3mm, a 1.07x ratio with the correct seasonal shape. It does
 * over-report summer drizzle (5-8mm in Aug/Sep where CHIRPS reads ~0), so any
 * reading sourced here is labelled as NASA POWER rather than CHIRPS.
 */
const POWER_DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";

export const NASA_SOURCE_URL =
  "https://power.larc.nasa.gov/docs/services/api/temporal/daily/";

type PowerResponse = {
  properties?: { parameter?: { PRECTOTCORR?: Record<string, number> } };
};

const compact = (date: string) => date.replaceAll("-", "");

/** Monthly totals summed from NASA POWER's daily corrected precipitation. */
export async function fetchMonthlyTotals(
  longitude: number,
  latitude: number,
  start: string,
  end: string
): Promise<Record<string, number>> {
  const query = new URLSearchParams({
    parameters: "PRECTOTCORR",
    community: "RE",
    longitude: String(longitude),
    latitude: String(latitude),
    start: compact(start),
    end: compact(end),
    format: "JSON",
    "time-standard": "UTC",
  });

  const response = await fetch(`${POWER_DAILY_URL}?${query}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`NASA POWER responded ${response.status}`);
  }

  const payload = (await response.json()) as PowerResponse;
  const values = payload.properties?.parameter?.PRECTOTCORR;
  if (!values) throw new Error("NASA POWER returned no precipitation values");

  const months: Record<string, number> = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = Number(raw);
    // POWER uses -999 for missing days.
    if (!Number.isFinite(value) || value < 0) continue;
    const month = `${key.slice(0, 4)}-${key.slice(4, 6)}`;
    months[month] = (months[month] ?? 0) + value;
  }
  for (const key of Object.keys(months)) {
    months[key] = Math.round(months[key] * 100) / 100;
  }
  return months;
}
