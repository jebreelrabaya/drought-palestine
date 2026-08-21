import chirpsMonthly from "./data/chirps-monthly.json" with { type: "json" };
import { CHIRPS_SOURCE_URL, dailyUrl, readPointsWithFallback, type ChirpsVersion } from "./chirps";
import { PALESTINIAN_CITIES, type PalestinianCity } from "./cities";

export { PALESTINIAN_CITIES };
export type { PalestinianCity };

export type RainfallGranularity = "daily" | "monthly" | "annual";

export type ChirpsSourceLabel = "CHIRPS v3.0" | "CHIRPS v2.0";

export type RainfallRecord = {
  period: string;
  precipitationMm: number;
  daysObserved: number;
  source: ChirpsSourceLabel;
};

export type RainfallSeries = {
  city: PalestinianCity;
  granularity: RainfallGranularity;
  records: RainfallRecord[];
  summary: {
    totalMm: number;
    averageMm: number;
    peakMm: number;
    peakPeriod: string | null;
    recordCount: number;
  };
  metadata: {
    source: string;
    parameter: "precipitation";
    unit: "mm";
    requestedStart: string;
    requestedEnd: string;
    rainySeasonLabel: string;
    availableThrough: string | null;
    aggregation: string;
    sourceUrl: string;
  };
};

type MonthlyEntry = { version: ChirpsVersion; values: Record<string, number | null> };
type MonthlyDataset = {
  generatedAt: string;
  product: string;
  cities: string[];
  months: Record<string, MonthlyEntry>;
};

const MONTHLY = chirpsMonthly as MonthlyDataset;

const FIRST_DATA_DATE = "2000-01-01";
// This application intentionally stops within the requested August 2026 window.
const MAX_REQUEST_DATE = "2026-08-20";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
// CHC answers 403 when hit hard, so keep the per-request fan-out modest.
const DAILY_CONCURRENCY = 8;

type DailyObservation = { date: string; precipitationMm: number };

const dailyCache = new Map<
  string,
  { expiresAt: number; version: ChirpsVersion; data: DailyObservation[] }
>();

export function sourceLabel(version: ChirpsVersion): ChirpsSourceLabel {
  return version === "3.0" ? "CHIRPS v3.0" : "CHIRPS v2.0";
}

function clampEndDate(date: string) {
  return date > MAX_REQUEST_DATE ? MAX_REQUEST_DATE : date;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function monthDays(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function rainySeasonStartForDate(date: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 8 ? year : year - 1;
}

export function rainySeasonLabel(seasonStartYear: number) {
  return `${seasonStartYear}/${seasonStartYear + 1}`;
}

export function resolveRainySeasonRange(seasonStartYear: number): { start: string; end: string } {
  if (seasonStartYear < 2000 || seasonStartYear > 2025) {
    throw new Error("الموسم المطري المختار غير متاح ضمن نطاق البيانات.");
  }
  return { start: `${seasonStartYear}-08-01`, end: `${seasonStartYear + 1}-05-31` };
}

export function resolveRainfallRange(
  granularity: RainfallGranularity,
  year?: number,
  month?: number
): { start: string; end: string } {
  if (granularity === "daily") {
    if (!year || !month) {
      throw new Error("يلزم اختيار السنة والشهر لعرض البيانات اليومية.");
    }
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = clampEndDate(`${year}-${String(month).padStart(2, "0")}-${monthDays(year, month)}`);
    if (start > MAX_REQUEST_DATE) {
      throw new Error("الفترة المطلوبة تأتي بعد آخر تاريخ متاح في المصدر.");
    }
    return { start, end };
  }

  if (granularity === "monthly" && year) {
    return resolveRainySeasonRange(year);
  }

  return { start: FIRST_DATA_DATE, end: MAX_REQUEST_DATE };
}

export function aggregateRainfallData(
  observations: DailyObservation[],
  granularity: RainfallGranularity,
  source: ChirpsSourceLabel = "CHIRPS v3.0"
): RainfallRecord[] {
  const groups = new Map<string, { total: number; daysObserved: number }>();

  for (const observation of observations) {
    const period =
      granularity === "daily"
        ? observation.date
        : granularity === "monthly"
          ? observation.date.slice(0, 7)
          : rainySeasonLabel(rainySeasonStartForDate(observation.date));
    const current = groups.get(period) ?? { total: 0, daysObserved: 0 };
    current.total += observation.precipitationMm;
    current.daysObserved += 1;
    groups.set(period, current);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, group]) => ({
      period,
      precipitationMm: round(group.total),
      daysObserved: group.daysObserved,
      source,
    }));
}

function eachDate(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Daily values are not precomputed, so they come straight from CHIRPS. One
 * raster per day means this only ever covers a single month at a time.
 */
async function fetchDailyObservations(
  city: PalestinianCity,
  start: string,
  end: string
): Promise<{ observations: DailyObservation[]; version: ChirpsVersion }> {
  const cacheKey = `${city.id}:${start}:${end}`;
  const cached = dailyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { observations: cached.data, version: cached.version };
  }

  const point = { id: city.id, longitude: city.longitude, latitude: city.latitude };
  const dates = eachDate(start, end);
  const observations: DailyObservation[] = [];
  let version: ChirpsVersion = "3.0";
  let failures = 0;

  for (let index = 0; index < dates.length; index += DAILY_CONCURRENCY) {
    const batch = dates.slice(index, index + DAILY_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async date => {
        try {
          const { version: used, samples } = await readPointsWithFallback(
            candidate => dailyUrl(candidate, date),
            [point]
          );
          return { date, used, value: samples[0]?.precipitationMm ?? null };
        } catch {
          return { date, used: null, value: null };
        }
      })
    );
    for (const result of results) {
      if (result.value === null || result.used === null) {
        failures++;
        continue;
      }
      if (result.used === "2.0") version = "2.0";
      observations.push({ date: result.date, precipitationMm: result.value });
    }
  }

  if (!observations.length) {
    throw new Error(
      failures
        ? "تعذر الوصول إلى بيانات CHIRPS اليومية للفترة المطلوبة؛ يُرجى المحاولة مرة أخرى."
        : "لم يعُد مصدر البيانات بقيم هطول صالحة للفترة المطلوبة."
    );
  }

  observations.sort((left, right) => left.date.localeCompare(right.date));
  dailyCache.set(cacheKey, { data: observations, version, expiresAt: Date.now() + CACHE_TTL_MS });
  return { observations, version };
}

/** Monthly and annual views read the precomputed CHIRPS monthly totals. */
function monthlyRecords(city: PalestinianCity, start: string, end: string) {
  const startKey = start.slice(0, 7);
  const endKey = end.slice(0, 7);
  const records: { period: string; precipitationMm: number; version: ChirpsVersion }[] = [];

  for (const [period, entry] of Object.entries(MONTHLY.months)) {
    if (period < startKey || period > endKey) continue;
    const value = entry.values[city.id];
    if (value === null || value === undefined) continue;
    records.push({ period, precipitationMm: value, version: entry.version });
  }

  return records.sort((left, right) => left.period.localeCompare(right.period));
}

export async function getRainfallSeries(input: {
  cityId: string;
  granularity: RainfallGranularity;
  year?: number;
  month?: number;
  seasonStartYear?: number;
}): Promise<RainfallSeries> {
  const city = PALESTINIAN_CITIES.find(candidate => candidate.id === input.cityId);
  if (!city) {
    throw new Error("المدينة المختارة غير مدعومة حاليًا.");
  }

  const allSeasons = input.granularity === "annual" && !input.seasonStartYear;
  const range =
    input.granularity === "daily"
      ? resolveRainfallRange("daily", input.year, input.month)
      : allSeasons
        ? { start: "2000-08-01", end: "2026-05-31" }
        : resolveRainySeasonRange(input.seasonStartYear ?? 2025);
  const selectedSeasonStartYear = input.seasonStartYear ?? rainySeasonStartForDate(range.start);

  let records: RainfallRecord[];
  let version: ChirpsVersion = "3.0";
  let availableThrough: string | null = null;

  if (input.granularity === "daily") {
    const daily = await fetchDailyObservations(city, range.start, range.end);
    version = daily.version;
    records = aggregateRainfallData(daily.observations, "daily", sourceLabel(version));
    availableThrough = daily.observations.at(-1)?.date ?? null;
  } else {
    const monthly = monthlyRecords(city, range.start, range.end);
    if (!monthly.length) {
      throw new Error("لا تتوفر بيانات CHIRPS للفترة المطلوبة.");
    }
    if (monthly.some(record => record.version === "2.0")) version = "2.0";
    availableThrough = monthly.at(-1)?.period ?? null;

    if (input.granularity === "monthly") {
      records = monthly.map(record => ({
        period: record.period,
        precipitationMm: round(record.precipitationMm),
        daysObserved: monthDays(Number(record.period.slice(0, 4)), Number(record.period.slice(5, 7))),
        source: sourceLabel(record.version),
      }));
    } else {
      const seasons = new Map<string, { total: number; days: number; version: ChirpsVersion }>();
      for (const record of monthly) {
        const label = rainySeasonLabel(rainySeasonStartForDate(`${record.period}-01`));
        const current = seasons.get(label) ?? { total: 0, days: 0, version: "3.0" as ChirpsVersion };
        current.total += record.precipitationMm;
        current.days += monthDays(Number(record.period.slice(0, 4)), Number(record.period.slice(5, 7)));
        if (record.version === "2.0") current.version = "2.0";
        seasons.set(label, current);
      }
      records = Array.from(seasons.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([period, season]) => ({
          period,
          precipitationMm: round(season.total),
          daysObserved: season.days,
          source: sourceLabel(season.version),
        }));
    }
  }

  const peak = records.reduce<RainfallRecord | null>(
    (currentPeak, record) =>
      !currentPeak || record.precipitationMm > currentPeak.precipitationMm ? record : currentPeak,
    null
  );
  const totalMm = round(records.reduce((sum, record) => sum + record.precipitationMm, 0));

  return {
    city,
    granularity: input.granularity,
    records,
    summary: {
      totalMm,
      averageMm: records.length ? round(totalMm / records.length) : 0,
      peakMm: peak?.precipitationMm ?? 0,
      peakPeriod: peak?.period ?? null,
      recordCount: records.length,
    },
    metadata: {
      source:
        input.granularity === "daily"
          ? `${sourceLabel(version)} Daily`
          : `${sourceLabel(version)} Monthly`,
      parameter: "precipitation",
      unit: "mm",
      requestedStart: range.start,
      requestedEnd: range.end,
      rainySeasonLabel: allSeasons ? "2000/2001 حتى 2025/2026" : rainySeasonLabel(selectedSeasonStartYear),
      availableThrough,
      aggregation:
        input.granularity === "daily"
          ? "قيم يومية من CHIRPS (تُوزَّع مجاميع البنتاد على الأيام عبر ERA5)"
          : input.granularity === "monthly"
            ? "مجاميع CHIRPS الشهرية لكل شهر من الموسم المطري (آب–أيار)"
            : "مجموع مجاميع CHIRPS الشهرية لكل موسم مطري (آب–أيار)",
      sourceUrl: CHIRPS_SOURCE_URL,
    },
  };
}
