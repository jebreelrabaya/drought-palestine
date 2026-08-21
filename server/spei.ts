// Standardized Precipitation-Evapotranspiration Index (SPEI),
// Vicente-Serrano et al. 2010. Water balance D = precipitation − PET, where PET
// is the Thornthwaite estimate (monthly mean temperature + latitude). D is
// accumulated over a window, fitted per calendar month to a 3-parameter
// log-logistic distribution (via probability-weighted moments), then mapped
// through the standard-normal quantile to a z-score.

import { invNorm } from "./spi";

export type TempPoint = {
  period: string; // "YYYY-MM", sorted asc, continuous
  precipitationMm: number | null;
  tempC: number | null; // monthly mean temperature
};

const SPEI_CLAMP = 3.09;

// ln Γ(x) via the Lanczos approximation (x > 0).
function lnGamma(x: number): number {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

const gammaFn = (x: number) => Math.exp(lnGamma(x));
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function midMonthDayOfYear(year: number, month: number) {
  const mid = Date.UTC(year, month - 1, 15);
  const start = Date.UTC(year, 0, 1);
  return Math.round((mid - start) / 86_400_000) + 1;
}

/** Thornthwaite potential evapotranspiration (mm/month) for each point. */
export function thornthwaitePet(series: TempPoint[], latitudeDeg: number): (number | null)[] {
  // Climatological mean temperature per calendar month → annual heat index I.
  const sums = new Array(13).fill(0);
  const counts = new Array(13).fill(0);
  for (const point of series) {
    if (point.tempC === null) continue;
    const month = Number(point.period.slice(5, 7));
    sums[month] += point.tempC;
    counts[month] += 1;
  }
  let heatIndex = 0;
  for (let month = 1; month <= 12; month++) {
    const mean = counts[month] ? sums[month] / counts[month] : 0;
    if (mean > 0) heatIndex += Math.pow(mean / 5, 1.514);
  }
  const a =
    6.75e-7 * heatIndex ** 3 - 7.71e-5 * heatIndex ** 2 + 1.792e-2 * heatIndex + 0.49239;
  const phi = (latitudeDeg * Math.PI) / 180;

  return series.map(point => {
    if (point.tempC === null || heatIndex <= 0) return null;
    const t = point.tempC;
    const year = Number(point.period.slice(0, 4));
    const month = Number(point.period.slice(5, 7));
    const uncorrected = t <= 0 ? 0 : 16 * Math.pow((10 * t) / heatIndex, a);
    // Daylight (N) and month-length corrections.
    const declination = 0.4093 * Math.sin((2 * Math.PI * midMonthDayOfYear(year, month)) / 365 - 1.405);
    const sunsetAngle = Math.acos(clamp(-Math.tan(phi) * Math.tan(declination), -1, 1));
    const daylightHours = (24 / Math.PI) * sunsetAngle;
    return uncorrected * (daylightHours / 12) * (daysInMonth(year, month) / 30);
  });
}

type LogLogistic = { alpha: number; beta: number; gamma: number };

// 3-parameter log-logistic fit via probability-weighted moments (Hosking).
function fitLogLogistic(values: number[]): LogLogistic | null {
  const x = [...values].sort((left, right) => left - right);
  const n = x.length;
  let w0 = 0;
  let w1 = 0;
  let w2 = 0;
  for (let i = 1; i <= n; i++) {
    const F = (i - 0.35) / n;
    w0 += x[i - 1];
    w1 += (1 - F) * x[i - 1];
    w2 += (1 - F) * (1 - F) * x[i - 1];
  }
  w0 /= n;
  w1 /= n;
  w2 /= n;

  const beta = (2 * w1 - w0) / (6 * w1 - w0 - 6 * w2);
  if (!Number.isFinite(beta) || beta <= 1) return null; // β>1 keeps Γ(1−1/β) defined and the mean finite
  const gammaProduct = gammaFn(1 + 1 / beta) * gammaFn(1 - 1 / beta);
  const alpha = ((w0 - 2 * w1) * beta) / gammaProduct;
  if (!Number.isFinite(alpha) || alpha <= 0) return null;
  const gamma = w0 - alpha * gammaProduct;
  return { alpha, beta, gamma };
}

function logLogisticCdf(x: number, { alpha, beta, gamma }: LogLogistic): number {
  if (x <= gamma) return 0.001;
  return 1 / (1 + Math.pow(alpha / (x - gamma), beta));
}

function rollingSum(values: (number | null)[], window: number, index: number): number | null {
  if (index < window - 1) return null;
  let total = 0;
  for (let i = index - window + 1; i <= index; i++) {
    if (values[i] === null) return null;
    total += values[i] as number;
  }
  return total;
}

/**
 * SPEI for every month at the given accumulation window (e.g. 6, 12). Months
 * without enough history or a fittable calendar group are omitted.
 */
export function computeSpei(series: TempPoint[], latitudeDeg: number, window: number): Map<string, number> {
  const pet = thornthwaitePet(series, latitudeDeg);
  const balance = series.map((point, i) =>
    point.precipitationMm === null || pet[i] === null ? null : point.precipitationMm - (pet[i] as number)
  );
  const acc = balance.map((_, i) => rollingSum(balance, window, i));

  const groups = new Map<number, number[]>();
  acc.forEach((value, i) => {
    if (value === null) return;
    const month = Number(series[i].period.slice(5, 7));
    const group = groups.get(month) ?? [];
    group.push(value);
    groups.set(month, group);
  });

  const fits = new Map<number, LogLogistic>();
  for (const [month, values] of Array.from(groups.entries())) {
    if (values.length < 4) continue;
    const fit = fitLogLogistic(values);
    if (fit) fits.set(month, fit);
  }

  const out = new Map<string, number>();
  acc.forEach((value, i) => {
    if (value === null) return;
    const month = Number(series[i].period.slice(5, 7));
    const fit = fits.get(month);
    if (!fit) return;
    const H = clamp(logLogisticCdf(value, fit), 0.001, 0.999);
    const spei = clamp(invNorm(H), -SPEI_CLAMP, SPEI_CLAMP);
    out.set(series[i].period, Math.round(spei * 100) / 100);
  });
  return out;
}
