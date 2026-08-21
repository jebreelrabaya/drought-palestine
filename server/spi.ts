// Standardized Precipitation Index (SPI), McKee et al. 1993.
// A gamma distribution is fitted per calendar month (Thom 1958 MLE) over the
// whole record, zero-adjusted, then each w-month accumulation is mapped through
// the gamma CDF and the standard-normal quantile to a z-score.

export type MonthlyPoint = { period: string; precipitationMm: number | null }; // "YYYY-MM", sorted asc, continuous

const SPI_CLAMP = 3.09; // matches H clamped to (0.001, 0.999)

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

// Regularized lower incomplete gamma P(a, x).
function lowerGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // series representation
    let ap = a;
    let del = 1 / a;
    let sum = del;
    for (let n = 0; n < 300; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // continued fraction (Lentz)
  const tiny = 1e-30;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  return 1 - q;
}

// Inverse standard-normal CDF (Acklam's rational approximation).
export function invNorm(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// Gamma (shape α, scale β) via Thom's maximum-likelihood approximation.
function fitGamma(values: number[]): { alpha: number; beta: number } {
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const meanLog = values.reduce((sum, v) => sum + Math.log(v), 0) / n;
  const A = Math.log(mean) - meanLog;
  const alpha = (1 + Math.sqrt(1 + (4 * A) / 3)) / (4 * A);
  return { alpha, beta: mean / alpha };
}

function rollingSum(series: MonthlyPoint[], window: number, index: number): number | null {
  if (index < window - 1) return null;
  let total = 0;
  for (let i = index - window + 1; i <= index; i++) {
    const value = series[i].precipitationMm;
    if (value === null) return null; // a gap anywhere in the window voids the accumulation
    total += value;
  }
  return total;
}

/**
 * SPI for every month in `series` at the given accumulation window (e.g. 6, 12).
 * Returns period → SPI; months without enough history or a fittable calendar
 * group are omitted.
 */
export function computeSpi(series: MonthlyPoint[], window: number): Map<string, number> {
  const acc = series.map((_, i) => rollingSum(series, window, i));

  const positives = new Map<number, number[]>(); // calendar month → positive accumulations
  const counts = new Map<number, { zero: number; total: number }>();
  acc.forEach((value, i) => {
    if (value === null) return;
    const month = Number(series[i].period.slice(5, 7));
    const count = counts.get(month) ?? { zero: 0, total: 0 };
    count.total += 1;
    counts.set(month, count);
    if (value <= 0) {
      count.zero += 1;
    } else {
      const group = positives.get(month) ?? [];
      group.push(value);
      positives.set(month, group);
    }
  });

  const fits = new Map<number, { alpha: number; beta: number }>();
  for (const [month, values] of Array.from(positives.entries())) {
    if (values.length >= 2) fits.set(month, fitGamma(values));
  }

  const out = new Map<string, number>();
  acc.forEach((value, i) => {
    if (value === null) return;
    const month = Number(series[i].period.slice(5, 7));
    const fit = fits.get(month);
    const count = counts.get(month);
    if (!fit || !count) return;
    const q = count.zero / count.total;
    const G = value <= 0 ? 0 : lowerGammaP(fit.alpha, value / fit.beta);
    const H = Math.min(0.999, Math.max(0.001, q + (1 - q) * G));
    const spi = Math.min(SPI_CLAMP, Math.max(-SPI_CLAMP, invNorm(H)));
    out.set(series[i].period, Math.round(spi * 100) / 100);
  });
  return out;
}
