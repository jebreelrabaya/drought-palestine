import { describe, expect, it } from "vitest";
import chirpsMonthly from "./data/chirps-monthly.json" with { type: "json" };
import tempMonthly from "./data/temp-monthly.json" with { type: "json" };
import { PALESTINIAN_CITIES } from "./cities";
import { computeSpei, thornthwaitePet, type TempPoint } from "./spei";

const PRECIP = chirpsMonthly as { months: Record<string, { values: Record<string, number | null> }> };
const TEMP = tempMonthly as { months: Record<string, { t2m: Record<string, number | null> }> };

function citySeries(cityId: string): TempPoint[] {
  return Object.keys(TEMP.months)
    .sort()
    .map(period => ({
      period,
      precipitationMm: PRECIP.months[period]?.values[cityId] ?? null,
      tempC: TEMP.months[period].t2m[cityId] ?? null,
    }));
}

const gazaLat = PALESTINIAN_CITIES.find(c => c.id === "gaza")!.latitude;

describe("thornthwaitePet", () => {
  it("ينتج تبخّرًا أعلى في الأشهر الحارّة منه في الباردة", () => {
    const series = citySeries("gaza");
    const pet = thornthwaitePet(series, gazaLat);
    const byPeriod = new Map(series.map((point, i) => [point.period, pet[i]]));
    const jan = byPeriod.get("2010-01")!;
    const jul = byPeriod.get("2010-07")!;
    expect(jul).toBeGreaterThan(jan);
    expect(jan).toBeGreaterThan(0);
  });
});

describe("computeSpei", () => {
  const series = citySeries("gaza");

  it("يحسب SPEI-6 وSPEI-12 ضمن مدى معقول مع تخطّي الأشهر الأولى", () => {
    const spei6 = computeSpei(series, gazaLat, 6);
    const spei12 = computeSpei(series, gazaLat, 12);

    expect(spei6.has("2000-01")).toBe(false);
    expect(spei6.has("2000-06")).toBe(true);
    expect(spei12.has("2000-11")).toBe(false);
    expect(spei12.has("2000-12")).toBe(true);

    for (const value of spei12.values()) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-3.09);
      expect(value).toBeLessThanOrEqual(3.09);
    }
  });

  it("SPEI مُعاير: متوسطه قريب من صفر ويظهر جفافًا ورطوبة", () => {
    const values = [...computeSpei(series, gazaLat, 12).values()];
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.25);
    expect(values.some(v => v <= -1)).toBe(true);
    expect(values.some(v => v >= 1)).toBe(true);
  });
});
