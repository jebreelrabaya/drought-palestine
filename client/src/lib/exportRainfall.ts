import * as XLSX from "xlsx";

type RainfallExportPayload = {
  city: { name: string; latitude: number; longitude: number };
  granularity: "daily" | "monthly" | "annual";
  records: Array<{ period: string; precipitationMm: number; daysObserved: number; source: string }>;
  metadata: {
    source: string;
    parameter: string;
    unit: string;
    requestedStart: string;
    requestedEnd: string;
    rainySeasonLabel: string;
    availableThrough: string | null;
    aggregation: string;
    sourceUrl: string;
  };
};

const granularityLabels = {
  daily: "يومي",
  monthly: "شهري",
  annual: "موسمي",
} as const;

export function exportRainfallToXlsx(payload: RainfallExportPayload) {
  const dataRows = payload.records.map(record => ({
    الفترة: record.period,
    "الهطول (ملم)": record.precipitationMm,
    "عدد الأيام المرصودة": record.daysObserved,
    المصدر: record.source,
  }));
  const metadataRows = [
    { الحقل: "المدينة", القيمة: payload.city.name },
    { الحقل: "نوع التجميع", القيمة: granularityLabels[payload.granularity] },
    { الحقل: "الموسم المطري", القيمة: payload.metadata.rainySeasonLabel },
    { الحقل: "مصدر البيانات", القيمة: payload.metadata.source },
    { الحقل: "المعلمة", القيمة: payload.metadata.parameter },
    { الحقل: "وحدة القياس", القيمة: payload.metadata.unit },
    { الحقل: "الفترة المطلوبة", القيمة: `${payload.metadata.requestedStart} إلى ${payload.metadata.requestedEnd}` },
    { الحقل: "آخر تاريخ متاح", القيمة: payload.metadata.availableThrough ?? "لا توجد قيَم متاحة" },
    { الحقل: "طريقة التجميع", القيمة: payload.metadata.aggregation },
    { الحقل: "رابط المصدر", القيمة: payload.metadata.sourceUrl },
    { الحقل: "إحداثيات المدينة", القيمة: `${payload.city.latitude}, ${payload.city.longitude}` },
  ];

  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.json_to_sheet(dataRows);
  const sourceSheet = XLSX.utils.json_to_sheet(metadataRows);
  dataSheet["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 16 }];
  sourceSheet["!cols"] = [{ wch: 22 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(workbook, dataSheet, "بيانات الأمطار");
  XLSX.utils.book_append_sheet(workbook, sourceSheet, "المصدر والمنهجية");
  XLSX.writeFile(workbook, `أمطار_${payload.city.name}_${granularityLabels[payload.granularity]}_موسم_${payload.metadata.rainySeasonLabel.replaceAll("/", "-").replaceAll(" ", "_")}.xlsx`);
}
