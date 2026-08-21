export type RainfallGranularity = "daily" | "monthly" | "annual";

export type PalestinianCity = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

export type RainfallRecord = {
  period: string;
  precipitationMm: number;
  daysObserved: number;
  source: "NASA POWER";
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
    source: "NASA POWER Daily API";
    parameter: "PRECTOTCORR";
    unit: "mm";
    requestedStart: string;
    requestedEnd: string;
    rainySeasonLabel: string;
    availableThrough: string | null;
    aggregation: string;
    sourceUrl: string;
  };
};

type DailyObservation = {
  date: string;
  precipitationMm: number;
};

type PowerResponse = {
  properties?: {
    parameter?: {
      PRECTOTCORR?: Record<string, number>;
    };
  };
};

const POWER_DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
const POWER_SOURCE_URL = "https://power.larc.nasa.gov/docs/services/api/temporal/daily/";
const FIRST_DATA_DATE = "2000-01-01";
// This application intentionally stops within the requested August 2026 window.
const MAX_REQUEST_DATE = "2026-08-20";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

const dailyCache = new Map<string, { expiresAt: number; data: DailyObservation[] }>();

export const PALESTINIAN_CITIES: PalestinianCity[] = [
  { id: "gaza", name: "غزة", latitude: 31.5017, longitude: 34.4668 },
  { id: "ramallah", name: "رام الله", latitude: 31.9038, longitude: 35.2034 },
  { id: "nablus", name: "نابلس", latitude: 32.2211, longitude: 35.2544 },
  { id: "hebron", name: "الخليل", latitude: 31.5326, longitude: 35.0998 },
  { id: "jenin", name: "جنين", latitude: 32.4595, longitude: 35.3009 },
  { id: "tulkarm", name: "طولكرم", latitude: 32.3104, longitude: 35.0286 },
  { id: "jericho", name: "أريحا", latitude: 31.8572, longitude: 35.4444 },
  { id: "bethlehem", name: "بيت لحم", latitude: 31.7054, longitude: 35.2024 },
  { id: "jerusalem", name: "القدس", latitude: 31.7683, longitude: 35.2137 },
  { id: "rafah", name: "رفح", latitude: 31.2969, longitude: 34.2436 },
  { id: "khan-younis", name: "خان يونس", latitude: 31.3460, longitude: 34.3063 },
  { id: "deir-al-balah", name: "دير البلح", latitude: 31.4181, longitude: 34.3493 },
  { id: "qalqilya", name: "قلقيلية", latitude: 32.1897, longitude: 34.9706 },
  { id: "salfit", name: "سلفيت", latitude: 32.0837, longitude: 35.1808 },
  { id: "tubas", name: "طوباس", latitude: 32.3209, longitude: 35.3699 },
];

function clampEndDate(date: string) {
  return date > MAX_REQUEST_DATE ? MAX_REQUEST_DATE : date;
}

function toPowerDate(date: string) {
  return date.replaceAll("-", "");
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
  granularity: RainfallGranularity
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
      source: "NASA POWER" as const,
    }));
}

async function fetchDailyObservations(
  city: PalestinianCity,
  start: string,
  end: string
): Promise<DailyObservation[]> {
  const cacheKey = `${city.id}:${start}:${end}`;
  const cached = dailyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const query = new URLSearchParams({
    parameters: "PRECTOTCORR",
    community: "RE",
    longitude: city.longitude.toString(),
    latitude: city.latitude.toString(),
    start: toPowerDate(start),
    end: toPowerDate(end),
    format: "JSON",
    "time-standard": "UTC",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28_000);

  try {
    const response = await fetch(`${POWER_DAILY_URL}?${query.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`تعذر الوصول إلى NASA POWER (رمز الاستجابة ${response.status}).`);
    }

    const payload = (await response.json()) as PowerResponse;
    const values = payload.properties?.parameter?.PRECTOTCORR;
    if (!values) {
      throw new Error("لم يعُد مصدر البيانات بقيم هطول صالحة للفترة المطلوبة.");
    }

    const observations = Object.entries(values)
      .map(([key, value]) => ({
        date: `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`,
        precipitationMm: Number(value),
      }))
      .filter(
        observation =>
          observation.date >= start &&
          observation.date <= end &&
          Number.isFinite(observation.precipitationMm) &&
          observation.precipitationMm >= 0 &&
          observation.precipitationMm < 900
      )
      .sort((left, right) => left.date.localeCompare(right.date));

    dailyCache.set(cacheKey, { data: observations, expiresAt: Date.now() + CACHE_TTL_MS });
    return observations;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("انتهت مهلة الاتصال بمصدر NASA POWER؛ يُرجى المحاولة مرة أخرى.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  const observations = await fetchDailyObservations(city, range.start, range.end);
  const records = aggregateRainfallData(observations, input.granularity);
  const peak = records.reduce<RainfallRecord | null>(
    (currentPeak, record) => (!currentPeak || record.precipitationMm > currentPeak.precipitationMm ? record : currentPeak),
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
      source: "NASA POWER Daily API",
      parameter: "PRECTOTCORR",
      unit: "mm",
      requestedStart: range.start,
      requestedEnd: range.end,
      rainySeasonLabel: allSeasons ? "2000/2001 حتى 2025/2026" : rainySeasonLabel(selectedSeasonStartYear),
      availableThrough: observations.at(-1)?.date ?? null,
      aggregation:
        input.granularity === "daily"
          ? "قيم يومية كما يعيدها المصدر"
          : input.granularity === "monthly"
            ? "مجموع القيم اليومية لكل شهر من الموسم المطري (آب–أيار)"
            : "مجموع القيم اليومية لكل موسم مطري (آب–أيار)",
      sourceUrl: POWER_SOURCE_URL,
    },
  };
}
