import { describe, expect, it } from "vitest";
import chirpsMonthly from "./data/chirps-monthly.json" with { type: "json" };
import { computeSpi, invNorm, type MonthlyPoint } from "./spi";

const MONTHLY = chirpsMonthly as { months: Record<string, { values: Record<string, number | null> }> };

function citySeries(cityId: string): MonthlyPoint[] {
  return Object.keys(MONTHLY.months)
    .sort()
    .map(period => ({ period, precipitationMm: MONTHLY.months[period].values[cityId] ?? null }));
}

describe("invNorm", () => {
  it("يطابق القيم المعيارية المعروفة للتوزيع الطبيعي", () => {
    expect(invNorm(0.5)).toBeCloseTo(0, 6);
    expect(invNorm(0.975)).toBeCloseTo(1.959964, 4);
    expect(invNorm(0.025)).toBeCloseTo(-1.959964, 4);
    expect(invNorm(0.84134)).toBeCloseTo(1, 3); // one standard deviation
  });
});

describe("computeSpi", () => {
  const series = citySeries("gaza");

  it("يحسب SPI-6 وSPI-12 لسلسلة غزة الشهرية ضمن مدى معقول", () => {
    const spi6 = computeSpi(series, 6);
    const spi12 = computeSpi(series, 12);

    // أول 5 أشهر بلا SPI-6، وأول 11 شهرًا بلا SPI-12
    expect(spi6.has("2000-01")).toBe(false);
    expect(spi6.has("2000-06")).toBe(true);
    expect(spi12.has("2000-11")).toBe(false);
    expect(spi12.has("2000-12")).toBe(true);

    for (const value of spi6.values()) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-3.09);
      expect(value).toBeLessThanOrEqual(3.09);
    }
  });

  it("SPI مُعاير: متوسطه قريب من صفر على كامل الفترة", () => {
    const values = [...computeSpi(series, 12).values()];
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.2);
    // يوجد جفاف (قيَم سالبة) ورطوبة (قيَم موجبة) عبر ربع القرن
    expect(values.some(v => v <= -1)).toBe(true);
    expect(values.some(v => v >= 1)).toBe(true);
  });
});
