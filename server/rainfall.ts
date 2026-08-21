import { TRPCError } from "@trpc/server";
import {
  FIRST_RAINY_SEASON_YEAR,
  currentRainySeasonStartYear,
  todayIso,
} from "@shared/const";
import chirpsMonthly from "./data/chirps-monthly.json" with { type: "json" };
import tempMonthly from "./data/temp-monthly.json" with { type: "json" };
import { CHIRPS_SOURCE_URL, dailyCandidates, readPointsFromCandidates, type ChirpsVersion } from "./chirps";
import { PALESTINIAN_CITIES, type PalestinianCity } from "./cities";
import { NASA_SOURCE_URL } from "./nasa";
import { computeSpi, type MonthlyPoint } from "./spi";
import { computeSpei, type TempPoint } from "./spei";

export { PALESTINIAN_CITIES };
export type { PalestinianCity };

export type RainfallGranularity = "daily" | "monthly" | "annual";

export type DataVersion = ChirpsVersion | "nasa";
export type ChirpsSourceLabel = "CHIRPS v3.0" | "CHIRPS v2.0" | "NASA POWER";

export type RainfallRecord = {
  period: string;
  precipitationMm: number;
  daysObserved: number;
  source: ChirpsSourceLabel;
  // Drought indices, populated for the monthly granularity only.
  spi6?: number | null;
  spi12?: number | null;
  spei6?: number | null;
  spei12?: number | null;
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
    // Season-end drought summary + temperature extremes (monthly granularity only).
    seasonHighTempC?: number | null;
    seasonLowTempC?: number | null;
    spi6End?: number | null;
    spi12End?: number | null;
    spei6End?: number | null;
    spei12End?: number | null;
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

type MonthlyEntry = {
  /** Source for every city in this month unless listed in `sources`. */
  version: DataVersion;
  values: Record<string, number | null>;
  /** Per-city exceptions, e.g. a city CHIRPS cannot cover. */
  sources?: Record<string, DataVersion>;
};
type MonthlyDataset = {
  generatedAt: string;
  product: string;
  cities: string[];
  months: Record<string, MonthlyEntry>;
};

const MONTHLY = chirpsMonthly as MonthlyDataset;
const MONTH_KEYS = Object.keys(MONTHLY.months).sort();

type TempDataset = {
  months: Record<string, { t2m: Record<string, number | null>; tmax: Record<string, number | null>; tmin: Record<string, number | null> }>;
};
const TEMP = tempMonthly as TempDataset;

/**
 * What the precomputed dataset actually covers. CHIRPS monthly finals lag the
 * calendar by roughly three weeks, so the newest season on the calendar is
 * usually still empty -- the UI must not default to it.
 */
export function datasetCoverage() {
  const firstMonth = MONTH_KEYS[0] ?? null;
  const lastMonth = MONTH_KEYS.at(-1) ?? null;
  return {
    firstMonth,
    lastMonth,
    latestSeasonStartYear: lastMonth
      ? rainySeasonStartForDate(`${lastMonth}-01`)
      : currentRainySeasonStartYear(),
  };
}

const FIRST_DATA_DATE = `${FIRST_RAINY_SEASON_YEAR}-01-01`;
// Coverage runs to today rather than a pinned date, so the app keeps showing
// the most recent CHIRPS data without an annual code change.
const maxRequestDate = () => todayIso();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
// CHC answers 403 when hit hard, so keep the per-request fan-out modest.
const DAILY_CONCURRENCY = 8;

type DailyObservation = { date: string; precipitationMm: number };

const dailyCache = new Map<
  string,
  { expiresAt: number; version: ChirpsVersion; preliminary: boolean; data: DailyObservation[] }
>();

export function sourceLabel(version: DataVersion): ChirpsSourceLabel {
  if (version === "nasa") return "NASA POWER";
  return version === "3.0" ? "CHIRPS v3.0" : "CHIRPS v2.0";
}

function clampEndDate(date: string) {
  const max = maxRequestDate();
  return date > max ? max : date;
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
  if (seasonStartYear < FIRST_RAINY_SEASON_YEAR || seasonStartYear > currentRainySeasonStartYear()) {
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
    if (start > maxRequestDate()) {
      throw new Error("الفترة المطلوبة تأتي بعد آخر تاريخ متاح في المصدر.");
    }
    return { start, end };
  }

  if (granularity === "monthly" && year) {
    return resolveRainySeasonRange(year);
  }

  return { start: FIRST_DATA_DATE, end: maxRequestDate() };
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
): Promise<{ observations: DailyObservation[]; version: ChirpsVersion; preliminary: boolean }> {
  const cacheKey = `${city.id}:${start}:${end}`;
  const cached = dailyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { observations: cached.data, version: cached.version, preliminary: cached.preliminary };
  }

  const point = { id: city.id, longitude: city.longitude, latitude: city.latitude };
  const dates = eachDate(start, end);
  const observations: DailyObservation[] = [];
  let version: ChirpsVersion = "3.0";
  let preliminary = false;
  let failures = 0;

  for (let index = 0; index < dates.length; index += DAILY_CONCURRENCY) {
    const batch = dates.slice(index, index + DAILY_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async date => {
        try {
          const read = await readPointsFromCandidates(dailyCandidates(date), [point]);
          return {
            date,
            used: read.version as ChirpsVersion | null,
            prelim: read.preliminary,
            value: read.samples[0]?.precipitationMm ?? null,
          };
        } catch {
          return { date, used: null as ChirpsVersion | null, prelim: false, value: null };
        }
      })
    );
    for (const result of results) {
      if (result.value === null || result.used === null) {
        failures++;
        continue;
      }
      if (result.used === "2.0") version = "2.0";
      if (result.prelim) preliminary = true;
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
  dailyCache.set(cacheKey, { data: observations, version, preliminary, expiresAt: Date.now() + CACHE_TTL_MS });
  return { observations, version, preliminary };
}

/** The city's full continuous monthly series — SPI must be fitted over all of it. */
function fullMonthlySeries(cityId: string): MonthlyPoint[] {
  return MONTH_KEYS.map(period => ({
    period,
    precipitationMm: MONTHLY.months[period].values[cityId] ?? null,
  }));
}

/** Precipitation + temperature joined over the full record — SPEI needs both. */
function fullTempSeries(cityId: string): TempPoint[] {
  return MONTH_KEYS.map(period => ({
    period,
    precipitationMm: MONTHLY.months[period].values[cityId] ?? null,
    tempC: TEMP.months[period]?.t2m[cityId] ?? null,
  }));
}

/** Monthly and annual views read the precomputed CHIRPS monthly totals. */
function monthlyRecords(city: PalestinianCity, start: string, end: string) {
  const startKey = start.slice(0, 7);
  const endKey = end.slice(0, 7);
  const records: { period: string; precipitationMm: number; version: DataVersion }[] = [];

  for (const [period, entry] of Object.entries(MONTHLY.months)) {
    if (period < startKey || period > endKey) continue;
    const value = entry.values[city.id];
    if (value === null || value === undefined) continue;
    records.push({
      period,
      precipitationMm: value,
      version: entry.sources?.[city.id] ?? entry.version,
    });
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
        ? { start: `${FIRST_RAINY_SEASON_YEAR}-08-01`, end: maxRequestDate() }
        : resolveRainySeasonRange(input.seasonStartYear ?? currentRainySeasonStartYear());
  const selectedSeasonStartYear = input.seasonStartYear ?? rainySeasonStartForDate(range.start);

  let records: RainfallRecord[];
  let version: ChirpsVersion = "3.0";
  let monthlyVersion: DataVersion = "3.0";
  let preliminary = false;
  let availableThrough: string | null = null;
  let seasonHighTempC: number | null = null;
  let seasonLowTempC: number | null = null;
  let spi6End: number | null = null;
  let spi12End: number | null = null;
  let spei6End: number | null = null;
  let spei12End: number | null = null;

  if (input.granularity === "daily") {
    const daily = await fetchDailyObservations(city, range.start, range.end);
    version = daily.version;
    preliminary = daily.preliminary;
    records = aggregateRainfallData(daily.observations, "daily", sourceLabel(version));
    availableThrough = daily.observations.at(-1)?.date ?? null;
  } else {
    const monthly = monthlyRecords(city, range.start, range.end);
    if (!monthly.length) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `لا تتوفر بيانات بعد للفترة المطلوبة. آخر شهر متاح هو ${datasetCoverage().lastMonth ?? "غير محدد"}.`,
      });
    }
    // Report the least-preferred source that contributed, so the label never
    // overstates the data: NASA beats v2.0 beats v3.0 in "worst wins" order.
    if (monthly.some(record => record.version === "2.0")) monthlyVersion = "2.0";
    if (monthly.some(record => record.version === "nasa")) monthlyVersion = "nasa";
    availableThrough = monthly.at(-1)?.period ?? null;

    if (input.granularity === "monthly") {
      // Indices are fitted over the whole record, then attached to the shown months.
      const spi6 = computeSpi(fullMonthlySeries(city.id), 6);
      const spi12 = computeSpi(fullMonthlySeries(city.id), 12);
      const spei6 = computeSpei(fullTempSeries(city.id), city.latitude, 6);
      const spei12 = computeSpei(fullTempSeries(city.id), city.latitude, 12);
      records = monthly.map(record => ({
        period: record.period,
        precipitationMm: round(record.precipitationMm),
        daysObserved: monthDays(Number(record.period.slice(0, 4)), Number(record.period.slice(5, 7))),
        source: sourceLabel(record.version),
        spi6: spi6.get(record.period) ?? null,
        spi12: spi12.get(record.period) ?? null,
        spei6: spei6.get(record.period) ?? null,
        spei12: spei12.get(record.period) ?? null,
      }));

      // Season summary: index values at the last shown month, and temperature extremes.
      const last = records.at(-1);
      spi6End = last?.spi6 ?? null;
      spi12End = last?.spi12 ?? null;
      spei6End = last?.spei6 ?? null;
      spei12End = last?.spei12 ?? null;
      for (const record of records) {
        const high = TEMP.months[record.period]?.tmax[city.id];
        const low = TEMP.months[record.period]?.tmin[city.id];
        if (high !== null && high !== undefined) seasonHighTempC = seasonHighTempC === null ? high : Math.max(seasonHighTempC, high);
        if (low !== null && low !== undefined) seasonLowTempC = seasonLowTempC === null ? low : Math.min(seasonLowTempC, low);
      }
    } else {
      const seasons = new Map<string, { total: number; days: number; version: DataVersion }>();
      for (const record of monthly) {
        const label = rainySeasonLabel(rainySeasonStartForDate(`${record.period}-01`));
        const current = seasons.get(label) ?? { total: 0, days: 0, version: "3.0" as DataVersion };
        current.total += record.precipitationMm;
        current.days += monthDays(Number(record.period.slice(0, 4)), Number(record.period.slice(5, 7)));
        if (record.version === "2.0" && current.version === "3.0") current.version = "2.0";
        if (record.version === "nasa") current.version = "nasa";
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
      seasonHighTempC,
      seasonLowTempC,
      spi6End,
      spi12End,
      spei6End,
      spei12End,
    },
    metadata: {
      source:
        input.granularity === "daily"
          ? `${sourceLabel(version)} Daily${preliminary ? " (أولي)" : ""}`
          : `${sourceLabel(monthlyVersion)} Monthly`,
      parameter: "precipitation",
      unit: "mm",
      requestedStart: range.start,
      requestedEnd: range.end,
      rainySeasonLabel: allSeasons
        ? `${rainySeasonLabel(FIRST_RAINY_SEASON_YEAR)} حتى ${rainySeasonLabel(currentRainySeasonStartYear())}`
        : rainySeasonLabel(selectedSeasonStartYear),
      availableThrough,
      aggregation:
        input.granularity === "daily"
          ? "قيم يومية من CHIRPS (تُوزَّع مجاميع البنتاد على الأيام عبر ERA5)"
          : input.granularity === "monthly"
            ? "مجاميع CHIRPS الشهرية لكل شهر من الموسم المطري (آب–أيار)"
            : "مجموع مجاميع CHIRPS الشهرية لكل موسم مطري (آب–أيار)",
      sourceUrl:
        input.granularity !== "daily" && monthlyVersion === "nasa"
          ? NASA_SOURCE_URL
          : CHIRPS_SOURCE_URL,
    },
  };
}
