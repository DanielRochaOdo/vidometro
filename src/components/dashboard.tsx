"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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

function MarketStat({ label, value, hint, accent = "var(--text)" }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <span style={{ minWidth: 94, display: "flex", flexDirection: "column", gap: 4 }}>
      <small style={{ color: "var(--text-faint)", fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</small>
      <strong style={{ color: accent, fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{value}</strong>
      {hint && <em style={{ color: "var(--text-faint)", fontSize: 9, fontStyle: "normal" }}>{hint}</em>}
    </span>
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
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o Vidômetro.");
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
  const chartData = trend.map((item) => ({ ...item, label: realtimeMode ? formatTime(item.dataConsulta) : shortDateFormatter.format(new Date(item.dataConsulta)) }));
  const allChartValues = chartData.flatMap((item) => [item.totalVidasAtivas, item.totalTitularesAtivos, item.totalDependentesAtivos]);
  const minLives = allChartValues.length ? Math.max(0, Math.floor(Math.min(...allChartValues) / 1000) * 1000) : 0;
  const chartDescription = realtimeMode
    ? "Cada coleta é um tick · a variação compara o tick atual com o imediatamente anterior"
    : oneDayMode
      ? "Hoje comparado ao dia anterior · última leitura diária consolidada"
      : "Uma amostra por dia · última leitura diária";

  const marketOpen = realtimeMode && trend.length ? trend[0] : null;
  const marketLast = realtimeMode && trend.length ? trend[trend.length - 1] : null;
  const marketHigh = realtimeMode && trend.length ? Math.max(...trend.map((item) => item.totalVidasAtivas)) : null;
  const marketLow = realtimeMode && trend.length ? Math.min(...trend.map((item) => item.totalVidasAtivas)) : null;
  const marketTickGrowth = realtimeMode ? growth?.totalVidasAtivas ?? null : null;
  const marketDirection = (marketTickGrowth?.percentage ?? 0) > 0 ? "var(--green)" : (marketTickGrowth?.percentage ?? 0) < 0 ? "#ffb4ab" : "var(--text)";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-left">
            <a className="brand" href="#inicio" aria-label="Vidômetro - início">
              <BrandMark />
              <span className="brand-copy">
                <span className="brand-title-row"><strong>Vidômetro</strong><em>Odontoart</em></span>
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
                <div><div className="section-title"><span className="material-symbols-outlined" aria-hidden="true">show_chart</span><h2>Evolução de Vidas Ativas</h2></div><p>{chartDescription}</p></div>
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
                <div className="custom-range" style={{ justifyContent: "space-between", alignItems: "stretch", gap: 18 }} aria-label="Ticker realtime">
                  <span style={{ minWidth: 78, display: "flex", flexDirection: "column", justifyContent: "center", gap: 5 }}>
                    <small style={{ color: "var(--green)", fontSize: 9, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" }}>● Ao vivo</small>
                    <strong style={{ fontSize: 11 }}>Sessão de hoje</strong>
                  </span>
                  <MarketStat label="Abertura" value={marketOpen ? numberFormatter.format(marketOpen.totalVidasAtivas) : "—"} hint={marketOpen ? formatTime(marketOpen.dataConsulta) : undefined} />
                  <MarketStat label="Máxima" value={marketHigh == null ? "—" : numberFormatter.format(marketHigh)} accent="var(--green)" />
                  <MarketStat label="Mínima" value={marketLow == null ? "—" : numberFormatter.format(marketLow)} accent="#ffb4ab" />
                  <MarketStat label="Último tick" value={marketLast ? numberFormatter.format(marketLast.totalVidasAtivas) : "—"} hint={marketLast ? formatTime(marketLast.dataConsulta) : undefined} />
                  <MarketStat label="Δ último tick" value={`${formatPercent(marketTickGrowth?.percentage)} | ${formatAbsolute(marketTickGrowth?.absolute)}`} accent={marketDirection} />
                </div>
              )}

              <div className="chart-legend" aria-label="Séries do gráfico"><span><i className="total" />Vidas ativas (Total)</span><span><i className="dependents" />Dependentes ({numberFormatter.format(dependents)})</span><span><i className="holders" />Titulares ({numberFormatter.format(holders)})</span></div>

              <div className="chart-surface">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 18, right: 20, left: 2, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--chart-grid-strong)" }} minTickGap={realtimeMode ? 18 : 24} />
                      <YAxis domain={[minLives, "auto"]} tickFormatter={(value) => numberFormatter.format(value)} tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={74} />
                      <Tooltip contentStyle={{ background: "var(--tooltip)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 14px 30px rgba(0,0,0,.35)" }} labelStyle={{ color: "var(--text)" }} formatter={(value, name) => [numberFormatter.format(Number(value)), name]} />
                      <Line type={realtimeMode ? "linear" : "monotone"} dataKey="totalVidasAtivas" name="Vidas ativas" stroke="var(--green)" strokeWidth={3.5} dot={{ r: realtimeMode ? 2.5 : 3.5, fill: "var(--chart-surface)", stroke: "var(--green)", strokeWidth: 2 }} activeDot={{ r: 6 }} animationDuration={realtimeMode ? 250 : 700} />
                      <Line type={realtimeMode ? "linear" : "monotone"} dataKey="totalDependentesAtivos" name="Dependentes" stroke="var(--blue)" strokeWidth={2.2} dot={realtimeMode || oneDayMode ? { r: 3, fill: "var(--chart-surface)", stroke: "var(--blue)", strokeWidth: 2 } : false} animationDuration={realtimeMode ? 250 : 700} />
                      <Line type={realtimeMode ? "linear" : "monotone"} dataKey="totalTitularesAtivos" name="Titulares" stroke="var(--cyan)" strokeWidth={2.2} dot={realtimeMode || oneDayMode ? { r: 3, fill: "var(--chart-surface)", stroke: "var(--cyan)", strokeWidth: 2 } : false} animationDuration={realtimeMode ? 250 : 700} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty"><span className="material-symbols-outlined" aria-hidden="true">monitoring</span><strong>{loading ? "Carregando histórico..." : realtimeMode ? "Aguardando o primeiro tick realtime." : "Ainda não há amostras neste período."}</strong><small>{realtimeMode ? "Cada nova coleta entra automaticamente como um tick da sessão." : "O histórico mantém uma única leitura consolidada por dia."}</small></div>
                )}
              </div>

              <div className="chart-footnote">
                <span>{realtimeMode ? "Os ticks são intradiários e temporários. No histórico definitivo fica somente o fechamento: a última leitura de cada dia." : oneDayMode ? "Comparação entre hoje e o fechamento do dia anterior." : "Histórico diário preservando a última leitura de cada data."}</span>
                <span className="verified"><i className="material-symbols-outlined" aria-hidden="true">verified</i> Sincronização automática</span>
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

      <footer className="app-footer"><div className="footer-inner"><span><strong>Vidômetro</strong></span></div></footer>
    </div>
  );
}
