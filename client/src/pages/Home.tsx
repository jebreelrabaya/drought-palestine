import { Button } from "@/components/ui/button";
import { exportRainfallToXlsx } from "@/lib/exportRainfall";
import { trpc } from "@/lib/trpc";
import {
  AreaChart,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CloudRain,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Info,
  LineChart,
  Loader2,
  MapPin,
  RefreshCw,
  Satellite,
  TableProperties,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  LineChart as RechartsLineChart,
} from "recharts";

type Granularity = "daily" | "monthly" | "annual";

const monthNames = [
  "كانون الثاني",
  "شباط",
  "آذار",
  "نيسان",
  "أيار",
  "حزيران",
  "تموز",
  "آب",
  "أيلول",
  "تشرين الأول",
  "تشرين الثاني",
  "كانون الأول",
];

const granularityOptions: Array<{ value: Granularity; label: string; icon: typeof CalendarDays }> = [
  { value: "daily", label: "يومي", icon: CalendarDays },
  { value: "monthly", label: "شهري", icon: BarChart3 },
  { value: "annual", label: "موسمي", icon: TrendingUp },
];

const rainySeasonMonths = [
  { value: 8, label: "آب" }, { value: 9, label: "أيلول" }, { value: 10, label: "تشرين الأول" }, { value: 11, label: "تشرين الثاني" }, { value: 12, label: "كانون الأول" },
  { value: 1, label: "كانون الثاني" }, { value: 2, label: "شباط" }, { value: 3, label: "آذار" }, { value: 4, label: "نيسان" }, { value: 5, label: "أيار" },
];
const rainySeasonYears = Array.from({ length: 26 }, (_, index) => 2000 + index);

function arabicNumber(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat("ar-PS", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

function formatPeriod(period: string, granularity: Granularity) {
  if (granularity === "annual") return `الموسم ${period}`;
  if (granularity === "monthly") {
    const [year, month] = period.split("-");
    return `${monthNames[Number(month) - 1]} ${year}`;
  }
  const [year, month, day] = period.split("-");
  return `${Number(day)} ${monthNames[Number(month) - 1]} ${year}`;
}

function formatShortPeriod(period: string, granularity: Granularity) {
  if (granularity === "annual") return period.replace("20", "").replace("/20", "/");
  if (granularity === "monthly") return `${period.slice(5)} / ${period.slice(2, 4)}`;
  return `${period.slice(8)} / ${period.slice(5, 7)}`;
}

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof CloudRain; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-[1.65rem] border border-white/75 bg-white/80 p-5 shadow-[0_16px_40px_-28px_rgba(16,72,70,0.55)] backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className={`grid size-10 place-items-center rounded-2xl ${accent}`}>
          <Icon className="size-5" />
        </span>
        <span className="text-xs font-semibold text-slate-400">{label}</span>
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-slate-800">{value}</p>
    </div>
  );
}

export default function Home() {
  const [cityId, setCityId] = useState("gaza");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [seasonStartYear, setSeasonStartYear] = useState("2025");
  const [month, setMonth] = useState("8");
  const [chartType, setChartType] = useState<"line" | "bar">("line");

  const catalogQuery = trpc.rainfall.catalog.useQuery();
  const queryInput = useMemo(
    () => ({
      cityId,
      granularity,
      seasonStartYear: seasonStartYear === "all" ? undefined : Number(seasonStartYear),
      year: granularity === "daily" ? Number(month) >= 8 ? Number(seasonStartYear) : Number(seasonStartYear) + 1 : undefined,
      month: granularity === "daily" ? Number(month) : undefined,
    }),
    [cityId, granularity, month, seasonStartYear]
  );
  const seriesQuery = trpc.rainfall.series.useQuery(queryInput, {
    retry: 1,
    staleTime: 1000 * 60 * 5,
  });
  const series = seriesQuery.data;
  const cityName = catalogQuery.data?.find(city => city.id === cityId)?.name ?? "المدينة المختارة";
  const displayRecords = series?.records ?? [];
  const chartData = displayRecords.map(record => ({
    ...record,
    label: formatShortPeriod(record.period, granularity),
    fullLabel: formatPeriod(record.period, granularity),
  }));

  const handleGranularity = (next: Granularity) => {
    setGranularity(next);
    if (next === "annual") setSeasonStartYear("all");
    if (next !== "annual" && seasonStartYear === "all") setSeasonStartYear("2025");
  };

  const handleExport = () => {
    if (series && series.records.length) exportRainfallToXlsx(series);
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#f5f8f4] text-slate-800" dir="rtl">
      <section className="relative overflow-hidden border-b border-emerald-950/5 bg-[#0b3f3c] text-white">
        <div className="absolute inset-0 opacity-35 [background-image:radial-gradient(circle_at_15%_30%,rgba(123,201,183,.35),transparent_30%),radial-gradient(circle_at_85%_0%,rgba(239,202,124,.3),transparent_26%)]" />
        <div className="hero-grid absolute inset-0 opacity-25" />
        <div className="hero-isohyet" aria-hidden="true"><span /><span /><span /></div>
        <nav className="relative mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
          <a href="#البداية" className="flex items-center gap-3" aria-label="العودة إلى بداية الصفحة">
            <span className="grid size-11 place-items-center rounded-2xl bg-[#dff4e9] text-[#0b5b55] shadow-lg shadow-black/10">
              <CloudRain className="size-6" />
            </span>
            <span>
              <span className="block font-[Noto_Kufi_Arabic] text-sm font-bold tracking-tight">مستكشف أمطار فلسطين</span>
              <span className="mt-0.5 block text-[10px] font-medium tracking-[0.12em] text-emerald-100/75">RAINFALL DATA PLATFORM</span>
            </span>
          </a>
          <a href="#المصدر" className="hidden items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium text-emerald-50 transition hover:bg-white/15 sm:flex">
            <Satellite className="size-3.5" />
            المصدر والمنهجية
          </a>
        </nav>

        <div id="البداية" className="relative mx-auto grid max-w-7xl gap-10 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:px-10 lg:pb-20 lg:pt-14">
          <div className="max-w-3xl pt-2">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#c8eadb]/20 bg-[#bfe6d7]/10 px-3 py-1.5 text-xs text-[#dff4e9]">
              <span className="size-1.5 rounded-full bg-[#f0c56c] shadow-[0_0_0_4px_rgba(240,197,108,.12)]" />
              بيانات مرجعية من الأقمار الصناعية والنماذج المناخية
            </div>
            <h1 className="max-w-2xl font-[Noto_Kufi_Arabic] text-3xl font-bold leading-[1.75] tracking-[-0.045em] text-white sm:text-4xl lg:text-[2.65rem]">
              افهم نمط المطر، <span className="text-[#eec76e]">مدينةً بعد مدينة.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-emerald-50/80 sm:text-lg">
              منصة عربية تتيح استعراض وتحميل الهطول اليومي والشهري والموسمي لمدن فلسطين وفق الموسم المطري الفلسطيني، من آب حتى أيار، ضمن التغطية المتاحة حتى آب 2026.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-sm text-emerald-100/90">
              <span className="inline-flex items-center gap-2"><Satellite className="size-4 text-[#eec76e]" />NASA POWER Daily API</span>
              <span className="inline-flex items-center gap-2"><FileSpreadsheet className="size-4 text-[#eec76e]" />تنزيل Excel فوري</span>
              <span className="inline-flex items-center gap-2"><MapPin className="size-4 text-[#eec76e]" />مدن فلسطينية متعددة</span>
            </div>
          </div>

          <div className="hero-observatory-card self-end rounded-[2rem] border border-white/15 bg-white/[0.085] p-5 shadow-2xl shadow-black/15 backdrop-blur-md sm:p-6">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-xs font-semibold text-[#eec76e]">نافذة البيانات</p>
                <p className="mt-1 font-[Noto_Kufi_Arabic] text-lg font-semibold">2000 — آب 2026</p>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-2 text-left">
                <p className="text-[10px] text-emerald-100/75">النطاق المكاني</p>
                <p className="mt-0.5 text-sm font-bold">فلسطين</p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-2 border-t border-white/10 pt-5 text-center text-xs text-emerald-100">
              <div><p className="font-[Noto_Kufi_Arabic] text-lg font-bold text-white">15</p><p className="mt-1">مدينة</p></div>
              <div className="border-x border-white/10"><p className="font-[Noto_Kufi_Arabic] text-lg font-bold text-white">3</p><p className="mt-1">مستويات</p></div>
              <div><p className="font-[Noto_Kufi_Arabic] text-lg font-bold text-white">.xlsx</p><p className="mt-1">تصدير</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="-mt-7 rounded-[2rem] border border-slate-200/80 bg-white p-4 shadow-[0_24px_55px_-35px_rgba(8,70,65,.45)] sm:p-6">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-bold tracking-wide text-[#0b7067]">لوحة الاستكشاف</p>
              <h2 className="mt-1 font-[Noto_Kufi_Arabic] text-base font-bold text-slate-800">اختر المدينة والموسم المطري المطلوب</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500"><Info className="size-4 text-[#c38b29]" />القيم بوحدة الملليمتر (ملم)</div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.45fr_1.25fr_1fr_1fr_auto] lg:items-end">
            <label className="field-label">
              <span>المدينة</span>
              <div className="select-shell"><MapPin className="field-icon" /><select value={cityId} onChange={event => setCityId(event.target.value)} aria-label="اختيار المدينة">
                {catalogQuery.data?.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
              </select><ChevronDown className="select-chevron" /></div>
            </label>

            <div className="field-label">
              <span>نوع البيانات</span>
              <div className="grid grid-cols-3 rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="نوع تجميع البيانات">
                {granularityOptions.map(option => {
                  const Icon = option.icon;
                  const selected = option.value === granularity;
                  return <button type="button" key={option.value} onClick={() => handleGranularity(option.value)} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${selected ? "bg-[#0b5b55] text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                    <Icon className="size-3.5" />{option.label}
                  </button>;
                })}
              </div>
            </div>

            <label className="field-label">
              <span>الموسم المطري</span>
              <div className="select-shell"><CalendarDays className="field-icon" /><select value={seasonStartYear} onChange={event => setSeasonStartYear(event.target.value)} aria-label="اختيار الموسم المطري" disabled={granularity === "annual" && seasonStartYear === "all"}>
                {granularity === "annual" && <option value="all">كافة المواسم</option>}
                {rainySeasonYears.map(item => <option key={item} value={item}>{item}/{item + 1}</option>)}
              </select><ChevronDown className="select-chevron" /></div>
            </label>

            <label className={`field-label transition ${granularity === "daily" ? "opacity-100" : "opacity-45"}`}>
              <span>شهر من الموسم</span>
              <div className="select-shell"><CalendarDays className="field-icon" /><select value={month} onChange={event => setMonth(event.target.value)} aria-label="اختيار الشهر" disabled={granularity !== "daily"}>
                {rainySeasonMonths.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select><ChevronDown className="select-chevron" /></div>
            </label>

            <Button type="button" variant="outline" onClick={() => seriesQuery.refetch()} disabled={seriesQuery.isFetching} className="h-11 rounded-xl border-[#0b5b55]/20 px-4 text-[#0b5b55] hover:bg-[#0b5b55] hover:text-white">
              {seriesQuery.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}<span className="mr-2">تحديث</span>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-16 pt-9 sm:px-8 lg:px-10">
        {seriesQuery.isLoading ? (
          <div className="grid min-h-[420px] place-items-center rounded-[2rem] border border-slate-200 bg-white">
            <div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#e7f4ee] text-[#0b7067]"><Loader2 className="size-6 animate-spin" /></span><p className="mt-4 font-semibold text-slate-700">نسترجع بيانات الهطول من المصدر…</p><p className="mt-1 text-sm text-slate-500">قد تستغرق الفترة الطويلة بضع ثوانٍ فقط.</p></div>
          </div>
        ) : seriesQuery.error ? (
          <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-8 text-center"><p className="font-[Noto_Kufi_Arabic] font-bold text-rose-900">تعذر عرض البيانات الآن</p><p className="mt-3 text-sm leading-7 text-rose-700">{seriesQuery.error.message}</p><Button onClick={() => seriesQuery.refetch()} className="mt-5 rounded-xl bg-rose-800 hover:bg-rose-900">حاول مجددًا</Button></div>
        ) : series ? (
          <>
            <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-[#0b7067]"><span className="size-2 rounded-full bg-[#17a58e]" />عرض مباشر من المصدر</div>
                <h2 className="mt-2 font-[Noto_Kufi_Arabic] text-xl font-bold leading-9 text-slate-800">أمطار {cityName} <span className="text-slate-400">—</span> {granularity === "daily" ? "قراءة يومية" : granularity === "monthly" ? "إجماليات شهرية" : "إجماليات موسمية"}</h2>
                <p className="mt-1 text-sm text-slate-500">الموسم المطري: {series.metadata.rainySeasonLabel} <span className="mx-1">·</span> الفترة: {series.metadata.requestedStart} إلى {series.metadata.requestedEnd}</p>
              </div>
              <Button type="button" onClick={handleExport} disabled={!series.records.length} className="h-11 rounded-xl bg-[#0b5b55] px-5 text-white shadow-lg shadow-[#0b5b55]/15 hover:bg-[#084944]">
                <Download className="size-4" /><span className="mr-2">تنزيل البيانات الظاهرة Excel</span>
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={CloudRain} label="إجمالي الهطول" value={`${arabicNumber(series.summary.totalMm, 1)} ملم`} accent="bg-[#e6f5ef] text-[#0b806f]" />
              <StatCard icon={AreaChart} label={granularity === "annual" ? "متوسط المواسم" : "متوسط الفترة"} value={`${arabicNumber(series.summary.averageMm, 1)} ملم`} accent="bg-[#e8f1fb] text-[#2776b9]" />
              <StatCard icon={TrendingUp} label="أعلى قراءة" value={`${arabicNumber(series.summary.peakMm, 1)} ملم`} accent="bg-[#fff4db] text-[#b97c12]" />
              <StatCard icon={TableProperties} label="سجلات معروضة" value={arabicNumber(series.summary.recordCount)} accent="bg-[#f1ebfb] text-[#7a52b3]" />
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_.85fr]">
              <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_12px_35px_-30px_rgba(8,70,65,.45)]">
                <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div><p className="text-sm font-bold text-slate-800">توزيع الهطول عبر الزمن</p><p className="mt-1 text-xs text-slate-500">استكشف القيم المجمّعة بحسب الاختيار الحالي.</p></div>
                  <div className="inline-flex w-fit rounded-xl bg-slate-100 p-1">
                    <button type="button" onClick={() => setChartType("line")} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${chartType === "line" ? "bg-white text-[#0b5b55] shadow-sm" : "text-slate-500"}`}><LineChart className="size-3.5" />خطي</button>
                    <button type="button" onClick={() => setChartType("bar")} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${chartType === "bar" ? "bg-white text-[#0b5b55] shadow-sm" : "text-slate-500"}`}><BarChart3 className="size-3.5" />أعمدة</button>
                  </div>
                </div>
                <div className="h-[330px] px-1 pb-3 pt-5 sm:px-4">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                    {chartType === "line" ? (
                      <RechartsLineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <defs><linearGradient id="rainGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0b8d80" stopOpacity=".34" /><stop offset="100%" stopColor="#0b8d80" stopOpacity="0" /></linearGradient></defs>
                        <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="3 5" />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#70817c", fontSize: 11 }} minTickGap={26} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#70817c", fontSize: 11 }} width={42} />
                        <Tooltip cursor={{ stroke: "#cfe2dc", strokeWidth: 1 }} contentStyle={{ borderRadius: 14, border: "1px solid #dcebe5", fontFamily: "Noto Sans Arabic", fontSize: 12 }} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""} formatter={(value: number) => [`${arabicNumber(value, 2)} ملم`, "الهطول"]} />
                        <Line type="monotone" dataKey="precipitationMm" stroke="#0b8d80" strokeWidth={3} dot={false} activeDot={{ r: 5, fill: "#e5b759", strokeWidth: 0 }} />
                      </RechartsLineChart>
                    ) : (
                      <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="3 5" />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#70817c", fontSize: 11 }} minTickGap={26} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#70817c", fontSize: 11 }} width={42} />
                        <Tooltip cursor={{ fill: "#f1f8f5" }} contentStyle={{ borderRadius: 14, border: "1px solid #dcebe5", fontFamily: "Noto Sans Arabic", fontSize: 12 }} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""} formatter={(value: number) => [`${arabicNumber(value, 2)} ملم`, "الهطول"]} />
                        <Bar dataKey="precipitationMm" fill="#0b8d80" radius={[6, 6, 0, 0]} maxBarSize={32} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </section>

              <aside className="rounded-[1.8rem] border border-[#d8e9e1] bg-[#edf6f1] p-6">
                <span className="grid size-11 place-items-center rounded-2xl bg-white text-[#0b7067] shadow-sm"><Satellite className="size-5" /></span>
                <h3 className="mt-5 font-[Noto_Kufi_Arabic] text-base font-bold leading-8 text-[#10443e]">قراءة شفافة للبيانات</h3>
                <dl className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between gap-4 border-b border-[#cfe3da] pb-3"><dt className="text-slate-500">المصدر</dt><dd className="font-semibold text-[#10443e]">NASA POWER</dd></div>
                  <div className="flex justify-between gap-4 border-b border-[#cfe3da] pb-3"><dt className="text-slate-500">المعلمة</dt><dd className="font-semibold text-[#10443e]">PRECTOTCORR</dd></div>
                  <div className="flex justify-between gap-4 border-b border-[#cfe3da] pb-3"><dt className="text-slate-500">آخر يوم متاح</dt><dd className="font-semibold text-[#10443e]">{series.metadata.availableThrough ?? "—"}</dd></div>
                  <div className="flex justify-between gap-4 border-b border-[#cfe3da] pb-3"><dt className="text-slate-500">الموسم</dt><dd className="font-semibold text-[#10443e]">{series.metadata.rainySeasonLabel}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">منهجية العرض</dt><dd className="max-w-[160px] text-left text-xs font-semibold leading-5 text-[#10443e]">{series.metadata.aggregation}</dd></div>
                </dl>
                <a href={series.metadata.sourceUrl} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 text-xs font-bold text-[#0b7067] hover:text-[#064e47]">وثائق المصدر الرسمية <ExternalLink className="size-3.5" /></a>
              </aside>
            </div>

            <section className="mt-5 overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_12px_35px_-30px_rgba(8,70,65,.45)]">
              <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h3 className="font-[Noto_Kufi_Arabic] text-sm font-bold text-slate-800">الجدول التفاعلي</h3><p className="mt-1 text-xs text-slate-500">البيانات المعروضة هي نفسها التي سيحتويها ملف Excel.</p></div><span className="w-fit rounded-full bg-[#e9f5ef] px-3 py-1 text-xs font-bold text-[#0b7067]">{arabicNumber(displayRecords.length)} سجل</span></div>
              <div className="max-h-[570px] overflow-auto">
                <table className="w-full min-w-[620px] text-right text-sm">
                  <thead className="sticky top-0 z-10 bg-[#f8fbf9] text-xs font-bold text-slate-500"><tr><th className="px-6 py-4">الفترة</th><th className="px-6 py-4">الهطول</th><th className="px-6 py-4">أيام مرصودة</th><th className="px-6 py-4">المصدر</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayRecords.map(record => <tr key={record.period} className="transition hover:bg-[#f7fbf9]"><td className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700">{formatPeriod(record.period, granularity)}</td><td className="whitespace-nowrap px-6 py-4 font-bold text-[#0b7067]">{arabicNumber(record.precipitationMm, 2)} <span className="text-xs font-medium text-slate-400">ملم</span></td><td className="px-6 py-4 text-slate-600">{arabicNumber(record.daysObserved)}</td><td className="px-6 py-4"><span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">{record.source}</span></td></tr>)}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </section>

      <section id="المصدر" className="border-y border-[#dce9e2] bg-[#eaf4ef]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:px-10">
          <div><p className="text-xs font-bold tracking-wide text-[#0b7067]">المصدر والمنهجية</p><h2 className="mt-3 font-[Noto_Kufi_Arabic] text-xl font-bold leading-10 text-[#10443e]">بيانات واضحة، وإسناد لا يترك مجالًا للالتباس.</h2></div>
          <div className="space-y-4 text-sm leading-8 text-slate-600"><p>يعرض هذا الإصدار قيَم الهطول اليومية <strong className="font-semibold text-slate-800">PRECTOTCORR</strong> من واجهة <strong className="font-semibold text-slate-800">NASA POWER Daily API</strong> عند إحداثيات مركز المدينة المختارة، ثم يجمعها حسابيًا لإنشاء الإجماليات الشهرية والموسمية وفق الموسم المطري الفلسطيني من آب حتى أيار. لا تُعرض القيمة الناقصة أو غير الصالحة من المصدر.</p><p>تُذكر <a className="font-semibold text-[#0b7067] underline decoration-[#7fc4ad] underline-offset-4" href="https://www.chc.ucsb.edu/data/chirps" target="_blank" rel="noreferrer">CHIRPS</a> كمرجع علمي مكمل لتقديرات الأمطار المعتمدة على الأقمار الصناعية والقياسات المحطية. لن تُنسب أي قراءة في هذا الإصدار إلى CHIRPS إلا إذا جرى استرجاعها منه مباشرة في إصدار لاحق.</p></div>
        </div>
      </section>

      <footer className="bg-[#083834] px-5 py-8 text-center text-sm text-emerald-100/75 sm:px-8"><p>مستكشف أمطار فلسطين — منصة استكشافية لبيانات الأمطار التاريخية.</p><p className="mt-2 text-xs">NASA POWER و CHIRPS هما مصدران مرجعيان مذكوران بوضوح في مواضع عرض البيانات.</p></footer>
    </main>
  );
}
