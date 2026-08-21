import { describe, expect, it } from "vitest";
import { PALESTINIAN_CITIES, aggregateRainfallData, rainySeasonLabel, resolveRainfallRange, resolveRainySeasonRange } from "./rainfall";

describe("aggregateRainfallData", () => {
  const dailyValues = [
    { date: "2025-08-01", precipitationMm: 1.25 },
    { date: "2025-08-02", precipitationMm: 2.5 },
    { date: "2026-02-01", precipitationMm: 4.75 },
    { date: "2026-08-01", precipitationMm: 3 },
  ];

  it("يجمع القيم اليومية في مجاميع شهرية مع عدد الأيام المرصودة", () => {
    expect(aggregateRainfallData(dailyValues, "monthly")).toEqual([
      { period: "2025-08", precipitationMm: 3.75, daysObserved: 2, source: "NASA POWER" },
      { period: "2026-02", precipitationMm: 4.75, daysObserved: 1, source: "NASA POWER" },
      { period: "2026-08", precipitationMm: 3, daysObserved: 1, source: "NASA POWER" },
    ]);
  });

  it("يجمع القيم اليومية حسب موسم آب إلى أيار ويحافظ على الترتيب الزمني", () => {
    expect(aggregateRainfallData(dailyValues, "annual")).toEqual([
      { period: "2025/2026", precipitationMm: 8.5, daysObserved: 3, source: "NASA POWER" },
      { period: "2026/2027", precipitationMm: 3, daysObserved: 1, source: "NASA POWER" },
    ]);
  });

  it("يضبط فلاتر اليوم والموسم المطري ضمن حدود آب 2026", () => {
    expect(resolveRainfallRange("daily", 2026, 8)).toEqual({ start: "2026-08-01", end: "2026-08-20" });
    expect(resolveRainySeasonRange(2025)).toEqual({ start: "2025-08-01", end: "2026-05-31" });
    expect(resolveRainfallRange("monthly", 2025)).toEqual({ start: "2025-08-01", end: "2026-05-31" });
    expect(rainySeasonLabel(2025)).toBe("2025/2026");
  });

  it("يوفر المدن الفلسطينية المطلوبة ضمن دليل الاختيار", () => {
    const cityNames = PALESTINIAN_CITIES.map(city => city.name);
    expect(cityNames).toEqual(expect.arrayContaining(["غزة", "رام الله", "نابلس", "الخليل", "جنين", "طولكرم", "أريحا", "بيت لحم", "القدس"]));
  });
});
