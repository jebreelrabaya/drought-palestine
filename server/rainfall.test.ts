import { currentRainySeasonStartYear, todayIso } from "@shared/const";
import { describe, expect, it } from "vitest";
import { PALESTINIAN_CITIES, aggregateRainfallData, getRainfallSeries, rainySeasonLabel, resolveRainfallRange, resolveRainySeasonRange } from "./rainfall";

describe("aggregateRainfallData", () => {
  const dailyValues = [
    { date: "2025-08-01", precipitationMm: 1.25 },
    { date: "2025-08-02", precipitationMm: 2.5 },
    { date: "2026-02-01", precipitationMm: 4.75 },
    { date: "2026-08-01", precipitationMm: 3 },
  ];

  it("يجمع القيم اليومية في مجاميع شهرية مع عدد الأيام المرصودة", () => {
    expect(aggregateRainfallData(dailyValues, "monthly")).toEqual([
      { period: "2025-08", precipitationMm: 3.75, daysObserved: 2, source: "CHIRPS v3.0" },
      { period: "2026-02", precipitationMm: 4.75, daysObserved: 1, source: "CHIRPS v3.0" },
      { period: "2026-08", precipitationMm: 3, daysObserved: 1, source: "CHIRPS v3.0" },
    ]);
  });

  it("يجمع القيم اليومية حسب موسم آب إلى أيار ويحافظ على الترتيب الزمني", () => {
    expect(aggregateRainfallData(dailyValues, "annual")).toEqual([
      { period: "2025/2026", precipitationMm: 8.5, daysObserved: 3, source: "CHIRPS v3.0" },
      { period: "2026/2027", precipitationMm: 3, daysObserved: 1, source: "CHIRPS v3.0" },
    ]);
  });

  it("يقصر النطاق اليومي على تاريخ اليوم ويضبط حدود الموسم المطري", () => {
    // الشهر الجاري: لا يتجاوز النطاق تاريخ اليوم
    const today = todayIso();
    const [year, month] = today.split("-").map(Number);
    expect(resolveRainfallRange("daily", year, month)).toEqual({
      start: `${today.slice(0, 7)}-01`,
      end: today,
    });
    // شهر مكتمل في الماضي: ينتهي بآخر يوم فيه
    expect(resolveRainfallRange("daily", 2020, 2)).toEqual({ start: "2020-02-01", end: "2020-02-29" });
    expect(resolveRainySeasonRange(2025)).toEqual({ start: "2025-08-01", end: "2026-05-31" });
    expect(resolveRainfallRange("monthly", 2025)).toEqual({ start: "2025-08-01", end: "2026-05-31" });
    expect(rainySeasonLabel(2025)).toBe("2025/2026");
  });

  it("يتيح الموسم المطري الجاري ويرفض ما بعده", () => {
    const current = currentRainySeasonStartYear();
    expect(() => resolveRainySeasonRange(current)).not.toThrow();
    expect(() => resolveRainySeasonRange(current + 1)).toThrow();
    expect(() => resolveRainySeasonRange(1999)).toThrow();
  });

  it("يوفر المدن الفلسطينية المطلوبة ضمن دليل الاختيار", () => {
    const cityNames = PALESTINIAN_CITIES.map(city => city.name);
    expect(cityNames).toEqual(expect.arrayContaining(["غزة", "رام الله", "نابلس", "الخليل", "جنين", "طولكرم", "أريحا", "بيت لحم", "القدس"]));
  });
});

describe("getRainfallSeries (CHIRPS precomputed monthly)", () => {
  it("يبني موسمًا شهريًا من مجاميع CHIRPS المحسوبة مسبقًا دون أي طلب شبكي", async () => {
    const series = await getRainfallSeries({
      cityId: "ramallah",
      granularity: "monthly",
      year: 2000,
      seasonStartYear: 2000,
    });

    expect(series.city.id).toBe("ramallah");
    expect(series.metadata.sourceUrl).toBe("https://www.chc.ucsb.edu/data/chirps");
    expect(series.metadata.source).toMatch(/^CHIRPS v[23]\.0 Monthly$/);
    // آب 2000 حتى أيار 2001
    expect(series.records.length).toBeGreaterThan(0);
    expect(series.records[0].period >= "2000-08").toBe(true);
    expect(series.records.at(-1)!.period <= "2001-05").toBe(true);
    for (const record of series.records) {
      expect(record.source).toMatch(/^CHIRPS v[23]\.0$/);
      expect(record.precipitationMm).toBeGreaterThanOrEqual(0);
    }
    // رام الله مدينة جبلية ماطرة: مجموع الموسم يجب أن يكون معقولًا
    expect(series.summary.totalMm).toBeGreaterThan(100);
    expect(series.summary.totalMm).toBeLessThan(1500);
  });

  it("يجمع المواسم في العرض الموسمي ويسمّي كل موسم بصيغة آب–أيار", async () => {
    const series = await getRainfallSeries({ cityId: "gaza", granularity: "annual" });

    expect(series.records.length).toBeGreaterThan(1);
    for (const record of series.records) {
      expect(record.period).toMatch(/^\d{4}\/\d{4}$/);
    }
    // غزة أقل مطرًا من رام الله؛ متوسط الموسم يجب أن يبقى ضمن مدى واقعي
    expect(series.summary.averageMm).toBeGreaterThan(50);
    expect(series.summary.averageMm).toBeLessThan(800);
  });
});
