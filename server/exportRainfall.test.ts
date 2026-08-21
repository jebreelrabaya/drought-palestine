import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";

vi.mock("xlsx", async importOriginal => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

import { exportRainfallToXlsx } from "../client/src/lib/exportRainfall";

describe("exportRainfallToXlsx", () => {
  it("ينشئ مصنفًا عربيًا يضم البيانات الظاهرة وإسناد المصدر", () => {
    const writeFile = vi.mocked(XLSX.writeFile);

    exportRainfallToXlsx({
      city: { name: "غزة", latitude: 31.5017, longitude: 34.4668 },
      granularity: "monthly",
      records: [{ period: "2025-01", precipitationMm: 32.4, daysObserved: 31, source: "CHIRPS v3.0", spi6: -1.2, spi12: 0.8, spei6: -0.9, spei12: 0.4 }],
      metadata: {
        source: "CHIRPS v3.0 Monthly",
        parameter: "precipitation",
        unit: "mm",
        requestedStart: "2025-01-01",
        requestedEnd: "2025-12-31",
        rainySeasonLabel: "2025/2026",
        availableThrough: "2025-12-31",
        aggregation: "مجاميع CHIRPS الشهرية لكل شهر",
        sourceUrl: "https://www.chc.ucsb.edu/data/chirps",
      },
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const call = writeFile.mock.calls[0];
    const workbook = call?.[0] as XLSX.WorkBook;
    expect(call?.[1]).toBe("أمطار_غزة_شهري_موسم_2025-2026.xlsx");
    expect(workbook.SheetNames).toEqual(["بيانات الأمطار", "المصدر والمنهجية"]);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["بيانات الأمطار"], { header: 1 });
    expect(rows[0]).toEqual(["الفترة", "الهطول (ملم)", "SPI-6", "SPI-12", "SPEI-6", "SPEI-12", "عدد الأيام المرصودة", "المصدر"]);
    expect(rows[1]).toEqual(["2025-01", 32.4, -1.2, 0.8, -0.9, 0.4, 31, "CHIRPS v3.0"]);
    writeFile.mockReset();
  });
});
