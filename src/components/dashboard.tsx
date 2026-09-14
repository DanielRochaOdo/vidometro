"use client";

import { useEffect, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { getSupabaseClient } from "@/lib/supabase";

type Snapshot = {
  totalVidasAtivas: number;
  totalTitularesAtivos: number;
  totalDependentesAtivos: number;
  dataConsulta: string;
  collectedAt: string;
};

type Growth = {
  absolute: number;
  percentage: number | null;
};

type DashboardPayload = {
  sampling: "day" | "realtime";
  latest: Snapshot | null;
  first: Snapshot | null;
  last: Snapshot | null;
  growth: {
    totalVidasAtivas: Growth;
    totalTitularesAtivos: Growth;
    totalDependentesAtivos: Growth;
  } | null;
  trend: Snapshot[];
  recent: Snapshot[];
};

type Preset = "realtime" | "1" | "7" | "30" | "90" | "custom";
type SavedPreferences = { preset?: Preset; from?: string; to?: string };
type ChartView = "smooth" | "ticks";
type ChartPoint = Snapshot & {
  label: string;
  tickAbsolute: number | null;
  tickPercentage: number | null;
};

type MarketStatProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "current";
  icon?: string;
};

const PREFERENCES_KEY = "vidometro-dashboard-preferences";
const VALID_PRESETS = new Set<Preset>(["realtime", "1", "7", "30", "90", "custom"]);
const MANUAL_REFRESH_POLL_MS = 1000;
const MANUAL_REFRESH_TIMEOUT_MS = 30_000;
const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit" });
const rangeOptions: Array<[Preset, string]> = [
  ["realtime", "Realtime"],
  ["1", "1 dia"],
  ["7", "7 dias"],
  ["30", "Últimos 30 dias"],
  ["90", "90 dias"],
  ["custom", "Personalizado"]
];

function fortalezaToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function fortalezaIsoDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isIsoDate(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
}

function formatPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 3 })}%`;
}

function formatAbsolute(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${numberFormatter.format(Math.trunc(value))}`;
}

function formatShare(part: number, total: number) {
  if (!total) return "—";
  return `${((part / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% do total`;
}

function calculateGrowth(previous: number, current: number): Growth {
  const absolute = current - previous;
  return {
    absolute,
    percentage: previous === 0 ? null : (absolute * 100) / previous
  };
}

function normalizeOneDayPayload(payload: DashboardPayload, previousDate: string, currentDate: string): DashboardPayload {
  const previous = payload.trend.find((item) => fortalezaIsoDate(item.dataConsulta) === previousDate) ?? null;
  const current = payload.trend.find((item) => fortalezaIsoDate(item.dataConsulta) === currentDate) ?? null;
  const trend: Snapshot[] = [];
  if (previous) trend.push(previous);
  if (current) trend.push(current);

  return {
    ...payload,
    first: previous,
    last: current,
    growth: previous && current ? {
      totalVidasAtivas: calculateGrowth(previous.totalVidasAtivas, current.totalVidasAtivas),
      totalTitularesAtivos: calculateGrowth(previous.totalTitularesAtivos, current.totalTitularesAtivos),
      totalDependentesAtivos: calculateGrowth(previous.totalDependentesAtivos, current.totalDependentesAtivos)
    } : null,
    trend
  };
}

function MetricDelta({ growth }: { growth?: Growth | null }) {
  const percentage = growth?.percentage;
  const kind = percentage == null || percentage === 0 ? "neutral" : percentage > 0 ? "positive" : "negative";
  const icon = percentage == null || percentage === 0 ? "remove" : percentage > 0 ? "arrow_upward" : "arrow_downward";
  return (
    <span className={`delta-chip ${kind}`}>
      <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
      {formatPercent(percentage)} | {formatAbsolute(growth?.absolute)}
    </span>
  );
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>;
}

function MarketStat({ label, value, hint, tone = "default", icon }: MarketStatProps) {
  return (
    <div className={`market-stat ${tone}`}>
      <span className="market-stat-label">
        {label}
        {icon && <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>}
      </span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function AnalyticsTooltip({ active, payload, label }: any) {
  const point = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;
  const direction = point.tickPercentage == null || point.tickPercentage === 0 ? "neutral" : point.tickPercentage > 0 ? "positive" : "negative";

  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip-header">
        <span><i /> Leitura selecionada</span>
        <strong>{String(label ?? "")}</strong>
      </div>
      <dl>
        <div><dt>Total vidas</dt><dd className="total">{numberFormatter.format(point.totalVidasAtivas)}</dd></div>
        <div><dt>Dependentes</dt><dd className="dependents">{numberFormatter.format(point.totalDependentesAtivos)}</dd></div>
        <div><dt>Titulares</dt><dd className="holders">{numberFormatter.format(point.totalTitularesAtivos)}</dd></div>
      </dl>
      <div className={`analytics-tooltip-delta ${direction}`}>
        <span>Variação anterior</span>
        <strong>{formatPercent(point.tickPercentage)} | {formatAbsolute(point.tickAbsolute)}</strong>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [today, setToday] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState<Preset>("30");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [chartView, setChartView] = useState<ChartView>("smooth");

  async function loadTelemetry(mode: Preset, nextFrom: string, nextTo: string, quiet = false): Promise<DashboardPayload | null> {
    if (!nextFrom || !nextTo) return null;
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const result = mode === "realtime"
        ? await supabase.rpc("vidometro_realtime")
        : await supabase.rpc("vidometro_dashboard", { p_from: nextFrom, p_to: nextTo });
      if (result.error) throw result.error;

      let nextData = result.data as DashboardPayload;
      if (mode === "1") nextData = normalizeOneDayPayload(nextData, nextFrom, nextTo);
      setData(nextData);
      return nextData;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o Vidâmetro.");
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    const savedTheme = localStorage.getItem("vidometro-theme");
    const resolvedTheme = savedTheme === "light" ? "light" : "dark";
    setTheme(resolvedTheme);
    document.documentElement.dataset.theme = resolvedTheme;

    const resolvedToday = fortalezaToday();
    let resolvedPreset: Preset = "30";
    let resolvedFrom = shiftIsoDate(resolvedToday, -29);
    let resolvedTo = resolvedToday;

    try {
      const raw = localStorage.getItem(PREFERENCES_KEY);
      const saved = raw ? JSON.parse(raw) as SavedPreferences : null;
      if (saved?.preset && VALID_PRESETS.has(saved.preset)) resolvedPreset = saved.preset;
      if (resolvedPreset === "custom") {
        if (isIsoDate(saved?.from) && isIsoDate(saved?.to) && (saved?.from ?? "") <= (saved?.to ?? "")) {
          resolvedFrom = saved!.from!;
          resolvedTo = saved!.to!;
        } else {
          resolvedPreset = "30";
        }
      }
    } catch {
      localStorage.removeItem(PREFERENCES_KEY);
    }

    if (resolvedPreset === "realtime") {
      resolvedFrom = resolvedToday;
      resolvedTo = resolvedToday;
    } else if (resolvedPreset === "1") {
      resolvedFrom = shiftIsoDate(resolvedToday, -1);
      resolvedTo = resolvedToday;
    } else if (resolvedPreset !== "custom") {
      resolvedFrom = shiftIsoDate(resolvedToday, -(Number(resolvedPreset) - 1));
      resolvedTo = resolvedToday;
    }

    setToday(resolvedToday);
    setPreset(resolvedPreset);
    setFrom(resolvedFrom);
    setTo(resolvedTo);
    setPreferencesReady(true);
    void loadTelemetry(resolvedPreset, resolvedFrom, resolvedTo);
  }, []);

  useEffect(() => {
    if (!preferencesReady || !from || !to) return;
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ preset, from, to } satisfies SavedPreferences));
  }, [preferencesReady, preset, from, to]);

  useEffect(() => {
    if (!preferencesReady || !from || !to) return;
    const interval = window.setInterval(() => void loadTelemetry(preset, from, to, true), 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [preferencesReady, preset, from, to]);

  useEffect(() => {
    if (!preferencesReady || !from || !to) return;
    const supabase = getSupabaseClient();
    const refresh = () => { void loadTelemetry(preset, from, to, true); };
    const channel = supabase.channel(`vidometro-active-lives-${preset}-${from}-${to}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_lives_snapshots" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_lives_realtime_samples" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [preferencesReady, preset, from, to]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("vidometro-theme", next);
    document.documentElement.dataset.theme = next;
  }

  async function refreshNow() {
    if (!from || !to || refreshing) return;

    const baselineCollectedAt = data?.latest?.collectedAt ?? null;
    setRefreshing(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const { data: requestId, error: refreshError } = await supabase.rpc("request_vidometro_refresh");
      if (refreshError) throw refreshError;

      if (requestId == null) {
        await loadTelemetry(preset, from, to, true);
        return;
      }

      const deadline = Date.now() + MANUAL_REFRESH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await wait(MANUAL_REFRESH_POLL_MS);
        const refreshed = await loadTelemetry(preset, from, to, true);
        const nextCollectedAt = refreshed?.latest?.collectedAt ?? null;
        if (nextCollectedAt && nextCollectedAt !== baselineCollectedAt) return;
      }

      await loadTelemetry(preset, from, to, true);
      setError("A consulta foi solicitada, mas a resposta demorou além do esperado. O painel continuará sincronizando automaticamente.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível solicitar a consulta imediata.");
    } finally {
      setRefreshing(false);
    }
  }

  function changePreset(value: Preset) {
    setPreset(value);
    if (value === "custom" || !today) return;
    const nextFrom = value === "realtime" ? today : value === "1" ? shiftIsoDate(today, -1) : shiftIsoDate(today, -(Number(value) - 1));
    setFrom(nextFrom);
    setTo(today);
    void loadTelemetry(value, nextFrom, today);
  }

  const latest = data?.latest;
  const growth = data?.growth;
  const totalLives = latest?.totalVidasAtivas ?? 0;
  const holders = latest?.totalTitularesAtivos ?? 0;
  const dependents = latest?.totalDependentesAtivos ?? 0;
  const lastCollectedAt = latest ? new Date(latest.collectedAt).getTime() : 0;
  const online = Boolean(lastCollectedAt && Date.now() - lastCollectedAt < 15 * 60 * 1000);
  const realtimeMode = preset === "realtime";
  const oneDayMode = preset === "1";
  const trend = data?.trend ?? [];
  const chartData: ChartPoint[] = trend.map((item, index) => {
    const previous = trend[index - 1];
    const tickAbsolute = previous ? item.totalVidasAtivas - previous.totalVidasAtivas : null;
    return {
      ...item,
      label: realtimeMode ? formatTime(item.dataConsulta) : shortDateFormatter.format(new Date(item.dataConsulta)),
      tickAbsolute,
      tickPercentage: previous?.totalVidasAtivas ? (tickAbsolute! * 100) / previous.totalVidasAtivas : null
    };
  });
  const allChartValues = chartData.flatMap((item) => [item.totalVidasAtivas, item.totalTitularesAtivos, item.totalDependentesAtivos]);
  const rawMin = allChartValues.length ? Math.min(...allChartValues) : 0;
  const rawMax = allChartValues.length ? Math.max(...allChartValues) : 0;
  const chartSpread = Math.max(rawMax - rawMin, 1000);
  const chartStep = chartSpread > 100000 ? 10000 : chartSpread > 20000 ? 5000 : 1000;
  const chartPadding = chartSpread * 0.08;
  const chartMin = Math.max(0, Math.floor((rawMin - chartPadding) / chartStep) * chartStep);
  const chartMax = Math.ceil((rawMax + chartPadding) / chartStep) * chartStep;
  const lastChartIndex = chartData.length - 1;
  const lastChartLabel = lastChartIndex >= 0 ? chartData[lastChartIndex].label : null;
  const sampledEvery = Math.max(1, Math.ceil(chartData.length / 14));
  const chartCurve = chartView === "smooth" ? "monotone" : "linear";
  const chartDescription = realtimeMode
    ? "Cada coleta é um tick (a cada 5 min) · A variação compara o tick atual com o imediatamente anterior."
    : oneDayMode
      ? "Hoje comparado ao dia anterior · última leitura diária consolidada"
      : "Uma amostra por dia · última leitura diária";

  const marketOpen = realtimeMode && trend.length ? trend[0] : null;
  const marketLast = realtimeMode && trend.length ? trend[trend.length - 1] : null;
  const marketPrevious = realtimeMode && trend.length > 1 ? trend[trend.length - 2] : null;
  const marketHigh = realtimeMode && trend.length ? Math.max(...trend.map((item) => item.totalVidasAtivas)) : null;
  const marketLow = realtimeMode && trend.length ? Math.min(...trend.map((item) => item.totalVidasAtivas)) : null;
  const marketTickGrowth = realtimeMode ? growth?.totalVidasAtivas ?? null : null;
  const marketDirection = (marketTickGrowth?.percentage ?? 0) > 0 ? "positive" : (marketTickGrowth?.percentage ?? 0) < 0 ? "negative" : "default";

  const sampledDot = (color: string, radius: number) => (props: any) => {
    const cx = Number(props.cx);
    const cy = Number(props.cy);
    const index = Number(props.index ?? 0);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const isLast = index === lastChartIndex;
    const isSampled = chartView === "ticks" && index % sampledEvery === 0;
    if (!isLast && !isSampled) return null;

    return (
      <g>
        {isLast && <circle cx={cx} cy={cy} r={radius + 4} fill={color} opacity={0.13} />}
        <circle cx={cx} cy={cy} r={isLast ? radius + 1 : radius} fill={color} stroke="var(--chart-surface)" strokeWidth={2} />
      </g>
    );
  };

  return (
    <div className="app-shell">
      <style jsx global>{`
        .chart-card{padding:0;overflow:hidden;position:relative;background:linear-gradient(180deg,var(--surface-low),var(--surface-lowest));box-shadow:0 18px 46px rgba(0,0,0,.16)}
        .chart-card::before{content:"";position:absolute;z-index:1;top:0;left:22%;right:22%;height:1px;background:linear-gradient(90deg,transparent,rgba(78,222,163,.48),transparent);pointer-events:none}
        .chart-card .analytics-heading{margin:0;padding:24px 24px 20px;align-items:center;border-bottom:1px solid var(--border);background:linear-gradient(180deg,rgba(255,255,255,.012),transparent)}
        .chart-title{gap:10px;flex-wrap:wrap}.chart-title>span:first-child{width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;border-radius:11px;background:rgba(16,185,129,.09);box-shadow:inset 0 0 0 1px rgba(78,222,163,.14)}
        .chart-mode-badge{margin-left:2px;padding:4px 7px;border-radius:999px;background:var(--surface-high);color:var(--cyan);font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;box-shadow:inset 0 0 0 1px var(--border)}
        .chart-mode-badge.live{color:var(--green);background:rgba(16,185,129,.09);box-shadow:inset 0 0 0 1px rgba(78,222,163,.18)}
        .chart-card .analytics-heading p{margin-left:48px;max-width:560px;line-height:1.5}
        .chart-card .range-switch{background:var(--surface-lowest);border:1px solid var(--border);box-shadow:none}
        .chart-card .range-switch button.active{background:rgba(16,185,129,.14);color:var(--green);box-shadow:inset 0 0 0 1px rgba(78,222,163,.2)}
        .chart-card .range-switch button:first-child.active::before{background:var(--green-bright);box-shadow:0 0 0 3px rgba(0,242,155,.08)}
        .chart-card>.custom-range{margin:16px 24px 0}
        .market-kpi-grid{padding:20px 24px 16px;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
        .market-live-card,.market-stat{min-height:92px;padding:13px 14px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--border);border-radius:12px;background:linear-gradient(145deg,var(--surface-card),var(--surface-low));box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}
        .market-live-card{position:relative;overflow:hidden}.market-live-card::after{content:"";position:absolute;width:68px;height:68px;right:-30px;top:-28px;border-radius:50%;background:rgba(16,185,129,.08);filter:blur(8px)}
        .market-live-status{display:flex;align-items:center;gap:7px;color:var(--green);font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.market-live-status i{position:relative;width:7px;height:7px;border-radius:50%;background:var(--green)}.market-live-status i::after{content:"";position:absolute;inset:-4px;border:1px solid rgba(78,222,163,.35);border-radius:50%;animation:pulse-ring 1.8s ease-out infinite}
        .market-live-card strong{font-size:12px}.market-live-card small{color:var(--text-faint);font-size:9px;font-variant-numeric:tabular-nums}
        .market-stat{position:relative;overflow:hidden}.market-stat-label{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--text-faint);font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.market-stat-label .material-symbols-outlined{font-size:15px}.market-stat>strong{font-family:"Plus Jakarta Sans",sans-serif;color:var(--text);font-size:18px;line-height:1;font-variant-numeric:tabular-nums}.market-stat>small{color:var(--text-faint);font-size:9px}.market-stat.positive .market-stat-label,.market-stat.positive>strong,.market-stat.positive>small{color:var(--green)}.market-stat.negative .market-stat-label,.market-stat.negative>strong,.market-stat.negative>small{color:#ff8e99}.market-stat.current{box-shadow:inset 0 0 0 1px rgba(78,222,163,.28),inset 0 1px 0 rgba(255,255,255,.02)}.market-stat.current .market-stat-label .material-symbols-outlined{color:var(--green);font-size:10px}
        .chart-toolbar{padding:12px 24px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,.025);border-bottom:1px solid var(--border)}
        .chart-card .chart-legend{margin:0;gap:18px}.chart-card .chart-legend span{gap:8px}.chart-card .chart-legend strong{padding:3px 6px;border-radius:5px;background:var(--surface-card);color:var(--text);font-size:9px;font-variant-numeric:tabular-nums;box-shadow:inset 0 0 0 1px var(--border)}
        .chart-view-control{display:flex;align-items:center;gap:9px;padding:5px 6px 5px 10px;border:1px solid var(--border);border-radius:10px;background:var(--surface-lowest)}.chart-view-control>span{color:var(--text-faint);font-size:9px;font-weight:600}.chart-view-buttons{display:flex;align-items:center;padding:2px;border-radius:8px;background:var(--surface-card)}.chart-view-buttons button{min-height:26px;padding:0 8px;border-radius:6px;cursor:pointer;background:transparent;color:var(--text-faint);font-size:9px;font-weight:700;transition:150ms ease}.chart-view-buttons button.active{background:rgba(16,185,129,.13);color:var(--green);box-shadow:inset 0 0 0 1px rgba(78,222,163,.15)}
        .chart-card .chart-surface{height:390px;margin:18px 20px 20px;padding:14px 8px 4px;border-color:var(--border);border-radius:13px;background:linear-gradient(180deg,var(--surface-lowest),var(--background));box-shadow:inset 0 14px 34px rgba(0,0,0,.10)}
        .chart-card .recharts-cartesian-grid-horizontal line{opacity:.72}.chart-card .recharts-line-curve,.chart-card .recharts-area-curve{filter:drop-shadow(0 0 6px rgba(16,185,129,.08))}
        .analytics-tooltip{min-width:205px;padding:12px;border:1px solid var(--border-strong);border-radius:11px;background:color-mix(in srgb,var(--tooltip) 94%,transparent);box-shadow:0 18px 40px rgba(0,0,0,.48);backdrop-filter:blur(10px)}
        .analytics-tooltip-header{padding-bottom:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid var(--border)}.analytics-tooltip-header span{display:inline-flex;align-items:center;gap:6px;color:var(--text-muted);font-size:9px;font-weight:700}.analytics-tooltip-header span i{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px rgba(78,222,163,.5)}.analytics-tooltip-header strong{color:var(--cyan);font-size:10px;font-variant-numeric:tabular-nums}.analytics-tooltip dl{margin:0;display:flex;flex-direction:column;gap:6px}.analytics-tooltip dl>div{display:flex;align-items:center;justify-content:space-between;gap:18px}.analytics-tooltip dt,.analytics-tooltip dd{margin:0;font-size:9px}.analytics-tooltip dt{color:var(--text-faint)}.analytics-tooltip dd{font-weight:800;font-variant-numeric:tabular-nums}.analytics-tooltip dd.total{color:var(--green)}.analytics-tooltip dd.dependents{color:var(--blue)}.analytics-tooltip dd.holders{color:var(--cyan)}.analytics-tooltip-delta{padding-top:8px;margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--border);font-size:8px}.analytics-tooltip-delta span{color:var(--text-faint)}.analytics-tooltip-delta strong{color:var(--text-muted);font-variant-numeric:tabular-nums}.analytics-tooltip-delta.positive strong{color:var(--green)}.analytics-tooltip-delta.negative strong{color:#ff8e99}
        .chart-card .chart-footnote{margin:0;padding:14px 24px;min-height:50px;border-top:1px solid var(--border);background:var(--surface-lowest)}.chart-sync-badge{padding:6px 9px;border-radius:8px;background:var(--surface-card);box-shadow:inset 0 0 0 1px var(--border)}.chart-sync-badge .material-symbols-outlined{animation:spin 8s linear infinite}
        @media(max-width:1120px){.market-kpi-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
        @media(max-width:860px){.chart-card .analytics-heading{align-items:flex-start}.market-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.chart-card .chart-surface{height:340px}.chart-toolbar{align-items:flex-start;flex-direction:column}.chart-view-control{align-self:stretch;justify-content:space-between}}
        @media(max-width:640px){.chart-card .analytics-heading{padding:18px 16px}.chart-card .analytics-heading p{margin-left:0}.chart-title>span:first-child{width:34px;height:34px}.market-kpi-grid{padding:16px;gap:8px}.market-live-card,.market-stat{min-height:84px;padding:11px}.market-stat>strong{font-size:16px}.chart-toolbar{padding:11px 16px}.chart-card .chart-surface{height:310px;margin:14px 10px 14px;padding-left:0}.chart-card .chart-footnote{padding:12px 16px}.chart-card>.custom-range{margin-inline:16px}}
      `}</style>

      <header className="app-header">
        <div className="header-inner">
          <div className="header-left">
            <a className="brand" href="#inicio" aria-label="Vidâmetro - início">
              <BrandMark />
              <span className="brand-copy">
                <span className="brand-title-row"><strong>Vidâmetro</strong><em>Odontoart</em></span>
                <small>Acompanhamento de Vidas Ativas</small>
              </span>
            </a>
            <nav className="main-nav" aria-label="Navegação principal">
              <a className="active" href="#inicio">Início</a>
              <a href="#historico">Histórico</a>
              <a href="#sobre">Sobre</a>
            </nav>
          </div>
          <div className="header-actions">
            <span className={`live-pill ${online ? "online" : "waiting"}`}><i><b /></i>{online ? "Online" : "Aguardando"}</span>
            <button className="icon-button" type="button" onClick={toggleTheme} aria-label="Alternar tema">
              <span className="material-symbols-outlined" aria-hidden="true">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main" id="inicio">
        <div className="dashboard-container">
          {error && <div className="error-banner" role="alert"><span className="material-symbols-outlined" aria-hidden="true">warning</span><span>{error}</span></div>}

          <section className="hero-section" aria-labelledby="hero-title">
            <div className="hero-copy">
              <div className="hero-kicker-row"><span className="telemetry-chip"><i /> Odontoart Online</span><span className="production-label">Telemetria em Produção</span></div>
              <div><h1 id="hero-title">Vidas ativas,<br /><em>em tempo real.</em></h1></div>
              <div className="sync-card">
                <div className="sync-info"><span className="sync-icon material-symbols-outlined" aria-hidden="true">schedule</span><span><small>Última consulta da API</small><strong>{formatDateTime(latest?.dataConsulta)}</strong></span></div>
                <button className="refresh-button" type="button" onClick={refreshNow} disabled={refreshing}><span className={`material-symbols-outlined ${refreshing ? "spin" : ""}`} aria-hidden="true">sync</span>{refreshing ? "Consultando API..." : "Atualizar painel"}</button>
              </div>
            </div>

            <article className="hero-metric-card">
              <div className="hero-glow" aria-hidden="true" />
              <div className="hero-metric-header">
                <div className="metric-title-group"><span className="metric-icon-large" aria-hidden="true"><span className="material-symbols-outlined" style={{ display: "block", width: 30, height: 30, lineHeight: 1, fontSize: 30, textAlign: "center", transform: "translateY(1px)" }}>groups</span></span><span><small>Métrica Consolidada</small><strong>Vidas Ativas</strong></span></div>
                <MetricDelta growth={growth?.totalVidasAtivas} />
              </div>
              <div className="hero-number-block"><strong>{loading && !latest ? "—" : numberFormatter.format(totalLives)}</strong><small><i /> {realtimeMode ? "variação em relação ao tick anterior" : oneDayMode ? "variação em relação ao dia anterior" : "variação no período selecionado"}</small></div>
              <div className="hero-metric-footer"><span><i /> Total Carteira Ativa</span><strong>{latest ? "100% elegíveis" : "Aguardando leitura"}</strong></div>
            </article>
          </section>

          <section className="metric-strip" aria-label="Composição das vidas ativas">
            <article className="mini-card holders-card"><div className="mini-card-top"><span className="mini-card-label"><i className="material-symbols-outlined" aria-hidden="true">badge</i>Titulares ativos</span><MetricDelta growth={growth?.totalTitularesAtivos} /></div><div className="mini-card-value"><strong>{numberFormatter.format(holders)}</strong><small>{formatShare(holders, totalLives)}</small></div></article>
            <article className="mini-card dependents-card"><div className="mini-card-top"><span className="mini-card-label"><i className="material-symbols-outlined" aria-hidden="true">family_restroom</i>Dependentes ativos</span><MetricDelta growth={growth?.totalDependentesAtivos} /></div><div className="mini-card-value"><strong>{numberFormatter.format(dependents)}</strong><small>{formatShare(dependents, totalLives)}</small></div></article>
            <article className="mini-card date-card"><div className="mini-card-top"><span className="mini-card-label"><i className="material-symbols-outlined" aria-hidden="true">calendar_today</i>Data da consulta</span><span className="timezone-label">UTC-3</span></div><div className="mini-card-value date-value"><strong>{formatDateTime(latest?.dataConsulta)}</strong><small>horário de Fortaleza</small></div></article>
          </section>

          <section className="analytics-grid" id="historico">
            <article className="analytics-card chart-card">
              <div className="analytics-heading">
                <div>
                  <div className="section-title chart-title">
                    <span className="material-symbols-outlined" aria-hidden="true">show_chart</span>
                    <h2>Evolução de Vidas Ativas</h2>
                    <span className={`chart-mode-badge ${realtimeMode ? "live" : ""}`}>{realtimeMode ? "Intradiário" : "Fechamentos"}</span>
                  </div>
                  <p>{chartDescription}</p>
                </div>
                <div className="range-switch" aria-label="Período do histórico">
                  {rangeOptions.map(([value, label]) => <button key={value} className={preset === value ? "active" : ""} type="button" onClick={() => changePreset(value)}>{label}</button>)}
                </div>
              </div>

              {preset === "custom" && (
                <div className="custom-range">
                  <label><span>De</span><input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} /></label>
                  <label><span>Até</span><input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label>
                  <button type="button" onClick={() => void loadTelemetry("custom", from, to)}>Aplicar período</button>
                </div>
              )}

              {realtimeMode && (
                <div className="market-kpi-grid" aria-label="Resumo da sessão realtime">
                  <div className="market-live-card">
                    <span className="market-live-status"><i /> Ao vivo</span>
                    <strong>Sessão de hoje</strong>
                    <small>{marketLast ? `${formatTime(marketLast.dataConsulta)} UTC-3` : "Aguardando tick"}</small>
                  </div>
                  <MarketStat label="Abertura" value={marketOpen ? numberFormatter.format(marketOpen.totalVidasAtivas) : "—"} hint={marketOpen ? formatTime(marketOpen.dataConsulta) : undefined} />
                  <MarketStat label="Máxima" value={marketHigh == null ? "—" : numberFormatter.format(marketHigh)} hint="Pico da sessão" tone="positive" icon="north" />
                  <MarketStat label="Mínima" value={marketLow == null ? "—" : numberFormatter.format(marketLow)} hint="Vale registrado" tone="negative" icon="south" />
                  <MarketStat label="Último tick" value={marketLast ? numberFormatter.format(marketLast.totalVidasAtivas) : "—"} hint={marketLast ? `${formatTime(marketLast.dataConsulta)} (atual)` : undefined} tone="current" icon="circle" />
                  <MarketStat label="Δ último tick" value={`${formatPercent(marketTickGrowth?.percentage)} | ${formatAbsolute(marketTickGrowth?.absolute)}`} hint={marketPrevious ? `vs. ${formatTime(marketPrevious.dataConsulta)}` : "Aguardando comparação"} tone={marketDirection} />
                </div>
              )}

              <div className="chart-toolbar">
                <div className="chart-legend" aria-label="Séries do gráfico">
                  <span><i className="total" />Vidas ativas (Total)<strong>{numberFormatter.format(totalLives)}</strong></span>
                  <span><i className="dependents" />Dependentes<strong>{numberFormatter.format(dependents)}</strong></span>
                  <span><i className="holders" />Titulares<strong>{numberFormatter.format(holders)}</strong></span>
                </div>
                <div className="chart-view-control" aria-label="Visualização do gráfico">
                  <span>Visualização:</span>
                  <div className="chart-view-buttons">
                    <button type="button" className={chartView === "smooth" ? "active" : ""} onClick={() => setChartView("smooth")}>Linha suave</button>
                    <button type="button" className={chartView === "ticks" ? "active" : ""} onClick={() => setChartView("ticks")}>{realtimeMode ? "Ticks amostrados" : "Pontos"}</button>
                  </div>
                </div>
              </div>

              <div className="chart-surface">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 18, right: 20, left: 2, bottom: 4 }}>
                      <defs>
                        <linearGradient id="totalLivesArea" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="var(--green)" stopOpacity={0.17} />
                          <stop offset="100%" stopColor="var(--green)" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={false} tickMargin={10} minTickGap={realtimeMode ? 28 : 22} />
                      <YAxis domain={[chartMin, chartMax]} tickCount={5} tickFormatter={(value) => numberFormatter.format(value)} tick={{ fill: "var(--text-faint)", fontSize: 10 }} tickLine={false} axisLine={false} width={72} tickMargin={7} />
                      {lastChartLabel && <ReferenceLine x={lastChartLabel} stroke="var(--cyan)" strokeOpacity={0.48} strokeDasharray="4 4" />}
                      <Tooltip content={<AnalyticsTooltip />} cursor={{ stroke: "var(--cyan)", strokeOpacity: 0.38, strokeDasharray: "4 4" }} />
                      <Area type={chartCurve} dataKey="totalVidasAtivas" name="Vidas ativas" stroke="var(--green)" strokeWidth={2.8} fill="url(#totalLivesArea)" dot={sampledDot("var(--green)", 2.5)} activeDot={{ r: 5.5, fill: "var(--green)", stroke: "var(--chart-surface)", strokeWidth: 2.5 }} animationDuration={realtimeMode ? 280 : 650} />
                      <Line type={chartCurve} dataKey="totalDependentesAtivos" name="Dependentes" stroke="var(--blue)" strokeWidth={2.1} dot={sampledDot("var(--blue)", 2.2)} activeDot={{ r: 4.5, fill: "var(--blue)", stroke: "var(--chart-surface)", strokeWidth: 2 }} animationDuration={realtimeMode ? 280 : 650} />
                      <Line type={chartCurve} dataKey="totalTitularesAtivos" name="Titulares" stroke="var(--cyan)" strokeWidth={2.1} dot={sampledDot("var(--cyan)", 2.2)} activeDot={{ r: 4.5, fill: "var(--cyan)", stroke: "var(--chart-surface)", strokeWidth: 2 }} animationDuration={realtimeMode ? 280 : 650} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty"><span className="material-symbols-outlined" aria-hidden="true">monitoring</span><strong>{loading ? "Carregando histórico..." : realtimeMode ? "Aguardando o primeiro tick realtime." : "Ainda não há amostras neste período."}</strong><small>{realtimeMode ? "Cada nova coleta entra automaticamente como um tick da sessão." : "O histórico mantém uma única leitura consolidada por dia."}</small></div>
                )}
              </div>

              <div className="chart-footnote">
                <span>{realtimeMode ? "Os ticks são intradiários e temporários. No histórico definitivo fica somente o fechamento: a última leitura de cada dia." : oneDayMode ? "Comparação entre hoje e o fechamento do dia anterior." : "Histórico diário preservando a última leitura de cada data."}</span>
                <span className="verified chart-sync-badge"><i className="material-symbols-outlined" aria-hidden="true">sync</i>{realtimeMode ? "Sincronização automática ativa (a cada 5m)" : "Fechamentos consolidados"}</span>
              </div>
            </article>

            <aside className="side-column">
              <article className="side-card summary-card">
                <div className="side-card-heading"><span><i className="material-symbols-outlined" aria-hidden="true">analytics</i><strong>Resumo</strong></span><small>{realtimeMode ? "Ticker ao vivo" : oneDayMode ? "Comparação diária" : "Período atual"}</small></div>
                <dl>
                  {realtimeMode ? (
                    <>
                      <div><dt>Abertura do dia</dt><dd>{marketOpen ? numberFormatter.format(marketOpen.totalVidasAtivas) : "—"}</dd></div>
                      <div><dt>Máxima do dia</dt><dd>{marketHigh == null ? "—" : numberFormatter.format(marketHigh)}</dd></div>
                      <div><dt>Mínima do dia</dt><dd>{marketLow == null ? "—" : numberFormatter.format(marketLow)}</dd></div>
                      <div><dt>Último tick</dt><dd>{marketLast ? `${numberFormatter.format(marketLast.totalVidasAtivas)} · ${formatTime(marketLast.dataConsulta)}` : "—"}</dd></div>
                      <div><dt>Variação (tick anterior)</dt><dd><MetricDelta growth={marketTickGrowth} /></dd></div>
                      <div><dt>Ticks na sessão</dt><dd className="secondary-value">{trend.length}</dd></div>
                    </>
                  ) : (
                    <>
                      <div><dt>Vidas Ativas (atual)</dt><dd>{numberFormatter.format(totalLives)}</dd></div>
                      <div><dt>{oneDayMode ? "Variação (dia anterior)" : "Variação (período)"}</dt><dd><MetricDelta growth={growth?.totalVidasAtivas} /></dd></div>
                      <div><dt>{oneDayMode ? "Dia anterior" : "Início do período"}</dt><dd>{numberFormatter.format(data?.first?.totalVidasAtivas ?? 0)}</dd></div>
                      <div><dt>{oneDayMode ? "Hoje" : "Fim do período"}</dt><dd>{numberFormatter.format(data?.last?.totalVidasAtivas ?? 0)}</dd></div>
                      <div><dt>{oneDayMode ? "Dias comparados" : "Dias com histórico"}</dt><dd className="secondary-value">{trend.length}</dd></div>
                    </>
                  )}
                </dl>
              </article>

              <article className="side-card recent-card">
                <div className="side-card-heading"><span><i className="material-symbols-outlined cyan" aria-hidden="true">history_toggle_off</i><strong>Fechamentos diários</strong></span><i className={`activity-dot ${online ? "online" : ""}`} /></div>
                <div className="recent-list">
                  {(data?.recent ?? []).map((item, index) => {
                    const previous = data?.recent[index + 1];
                    const absolute = previous ? item.totalVidasAtivas - previous.totalVidasAtivas : null;
                    const pct = previous?.totalVidasAtivas ? (absolute! / previous.totalVidasAtivas) * 100 : null;
                    return (
                      <div className="recent-row" key={`${item.collectedAt}-${index}`}>
                        <div className="recent-date"><i /><span><strong>{formatDate(item.dataConsulta)}</strong><small>{formatTime(item.dataConsulta)} · Última leitura do dia</small></span></div>
                        <div className="recent-values"><strong>{numberFormatter.format(item.totalVidasAtivas)}</strong><span className={pct != null && pct < 0 ? "negative" : pct != null ? "positive" : "neutral"}>{formatPercent(pct)} | {formatAbsolute(absolute)}</span></div>
                      </div>
                    );
                  })}
                  {!data?.recent.length && <div className="recent-empty"><span className="material-symbols-outlined" aria-hidden="true">inventory_2</span><p>Sem fechamentos diários ainda.</p></div>}
                </div>
                <div className="daily-note"><span className="material-symbols-outlined" aria-hidden="true">info</span>O fechamento diário é sempre a última leitura registrada naquela data.</div>
              </article>
            </aside>
          </section>

          <section className="about-card" id="sobre"><span className="material-symbols-outlined" aria-hidden="true">database</span><div><strong>Telemetria operacional Odontoart</strong><p>Realtime funciona como um ticker intradiário: cada coleta é um tick. O histórico definitivo mantém somente a última leitura de cada dia.</p></div></section>
        </div>
      </main>

      <footer className="app-footer"><div className="footer-inner"><span><strong>Vidâmetro</strong></span></div></footer>
    </div>
  );
}
