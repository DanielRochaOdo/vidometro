"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type Snapshot = {
  id: string;
  totalVidasAtivas: number;
  totalTitularesAtivos: number;
  totalDependentesAtivos: number;
  dataConsulta: string;
  collectedAt: string;
};

type Growth = { absolute: number; percentage: number | null };

type DashboardData = {
  latest: Snapshot | null;
  period: {
    from: string;
    to: string;
    first: Snapshot | null;
    last: Snapshot | null;
    growth: {
      totalVidasAtivas: Growth;
      totalTitularesAtivos: Growth;
      totalDependentesAtivos: Growth;
    };
  };
  trend: Snapshot[];
  sampling: "hour" | "day";
  collectionIntervalMinutes: number;
};

type Envelope<T> = { success: boolean; data?: T; error?: string };

const nf = new Intl.NumberFormat("pt-BR");
const pf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function todayFortaleza() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function shiftDate(date: string, delta: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta, 12)).toISOString().slice(0, 10);
}

function dateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function shortDate(value: string) {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

async function envelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body?.success || body.data === undefined) {
    throw new Error(body?.error || "Não foi possível concluir a operação.");
  }
  return body.data;
}

function TrendPill({ growth }: { growth: Growth }) {
  const positive = growth.absolute > 0;
  const negative = growth.absolute < 0;
  const sign = positive ? "+" : "";
  const label = growth.percentage === null
    ? `${sign}${nf.format(growth.absolute)}`
    : `${sign}${nf.format(growth.absolute)} · ${sign}${pf.format(growth.percentage)}%`;
  return <span className={`trend-pill ${positive ? "up" : negative ? "down" : "flat"}`}>{label}</span>;
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = document.documentElement.dataset.theme === "dark";
    setDark(next);
    setReady(true);
  }, []);

  function toggle() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("vidometro-theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <button className="icon-button" onClick={toggle} type="button" aria-label="Alternar tema" title="Alternar tema">
      {ready && dark ? "☀" : "◐"}
    </button>
  );
}

function MetricCard({ label, value, growth, note }: { label: string; value: number; growth?: Growth; note: string }) {
  return (
    <article className="metric-card">
      <div className="metric-head">
        <span className="eyebrow">{label}</span>
        {growth ? <TrendPill growth={growth} /> : null}
      </div>
      <strong className="metric-value">{nf.format(value)}</strong>
      <p>{note}</p>
    </article>
  );
}

export function Dashboard() {
  const [today] = useState(todayFortaleza);
  const [draft, setDraft] = useState(() => ({ from: shiftDate(todayFortaleza(), -29), to: todayFortaleza() }));
  const [range, setRange] = useState(draft);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams(range);
    const response = await fetch(`/api/dashboard?${params}`, { cache: "no-store" });
    setData(await envelope<DashboardData>(response));
  }, [range]);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setError(null);
    try {
      await envelope(await fetch("/api/collect", { method: "POST" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar o Vidômetro.");
      try { await load(); } catch { /* preserva erro de coleta */ }
    } finally {
      setLoading(false);
      if (showSpinner) setRefreshing(false);
    }
  }, [load]);

  useEffect(() => { void refresh(false); }, [refresh]);
  useEffect(() => {
    const id = window.setInterval(() => void refresh(false), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const latest = data?.latest;
  const growth = data?.period.growth;
  const total = latest?.totalVidasAtivas ?? 0;
  const holderShare = total ? ((latest?.totalTitularesAtivos ?? 0) / total) * 100 : 0;
  const dependentShare = total ? ((latest?.totalDependentesAtivos ?? 0) / total) * 100 : 0;

  const chartData = useMemo(() => (data?.trend ?? []).map((row) => ({
    ...row,
    label: new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Fortaleza",
      day: "2-digit",
      month: "2-digit",
      ...(data?.sampling === "hour" ? { hour: "2-digit", minute: "2-digit" } : {})
    }).format(new Date(row.dataConsulta))
  })), [data]);

  function applyRange() {
    if (!draft.from || !draft.to || draft.from > draft.to) {
      setError("Selecione um período válido.");
      return;
    }
    setLoading(true);
    setError(null);
    setRange(draft);
  }

  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="dashboard-wrap">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">V</div>
            <div>
              <strong>VIDÔMETRO</strong>
              <span>Odontoart Online</span>
            </div>
          </div>
          <div className="top-actions">
            <span className="live-badge"><i /> atualização a cada 5 min</span>
            <ThemeToggle />
          </div>
        </header>

        <section className="hero-row">
          <div>
            <span className="section-kicker">PAINEL OPERACIONAL</span>
            <h1>Vidas ativas em tempo real</h1>
            <p>Acompanhe a base ativa da Odontoart, a composição de titulares e dependentes e a evolução em qualquer período.</p>
          </div>
          <button className="refresh-button" onClick={() => void refresh(true)} disabled={refreshing} type="button">
            <span className={refreshing ? "spin" : ""}>↻</span>
            {refreshing ? "Consultando..." : "Atualizar agora"}
          </button>
        </section>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="primary-grid">
          <article className="total-card">
            <div className="total-card-top">
              <span className="eyebrow light">TOTAL DE VIDAS ATIVAS</span>
              {growth ? <TrendPill growth={growth.totalVidasAtivas} /> : null}
            </div>
            <div className="big-number">{loading && !latest ? "—" : nf.format(total)}</div>
            <div className="consult-info">
              <span>Data da consulta</span>
              <strong>{dateTime(latest?.dataConsulta)}</strong>
            </div>
            <div className="card-glow" />
          </article>

          <div className="side-metrics">
            <MetricCard
              label="Titulares ativos"
              value={latest?.totalTitularesAtivos ?? 0}
              growth={growth?.totalTitularesAtivos}
              note={`${pf.format(holderShare)}% da base atual`}
            />
            <MetricCard
              label="Dependentes ativos"
              value={latest?.totalDependentesAtivos ?? 0}
              growth={growth?.totalDependentesAtivos}
              note={`${pf.format(dependentShare)}% da base atual`}
            />
          </div>
        </section>

        <section className="period-panel">
          <div className="period-copy">
            <span className="section-kicker">CRESCIMENTO</span>
            <h2>Variação no período</h2>
            <p>Compara o primeiro e o último registro disponíveis dentro do intervalo escolhido.</p>
          </div>
          <div className="date-controls">
            <label>De<input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft((v) => ({ ...v, from: e.target.value }))} /></label>
            <label>Até<input type="date" value={draft.to} min={draft.from} max={today} onChange={(e) => setDraft((v) => ({ ...v, to: e.target.value }))} /></label>
            <button type="button" onClick={applyRange}>Aplicar</button>
          </div>

          <div className="growth-grid">
            <div><span>Vidas ativas</span>{growth ? <TrendPill growth={growth.totalVidasAtivas} /> : "—"}</div>
            <div><span>Titulares</span>{growth ? <TrendPill growth={growth.totalTitularesAtivos} /> : "—"}</div>
            <div><span>Dependentes</span>{growth ? <TrendPill growth={growth.totalDependentesAtivos} /> : "—"}</div>
          </div>
          <div className="period-foot">
            {shortDate(range.from)} a {shortDate(range.to)}
            {data?.period.first && data?.period.last
              ? ` · ${nf.format(data.period.first.totalVidasAtivas)} → ${nf.format(data.period.last.totalVidasAtivas)} vidas`
              : " · sem amostras suficientes no período"}
          </div>
        </section>

        <section className="charts-grid">
          <article className="chart-card">
            <div className="chart-title"><div><span className="section-kicker">EVOLUÇÃO</span><h2>Total de vidas ativas</h2></div><span className="sample-chip">{data?.sampling === "hour" ? "por hora" : "por dia"}</span></div>
            <div className="chart-area">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 12, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={25} />
                    <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={62} />
                    <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14 }} formatter={(value) => nf.format(Number(value ?? 0))} />
                    <Line type="monotone" dataKey="totalVidasAtivas" name="Vidas ativas" stroke="#20d7ba" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="empty-chart">As amostras aparecerão aqui após as primeiras coletas.</div>}
            </div>
          </article>

          <article className="chart-card">
            <div className="chart-title"><div><span className="section-kicker">COMPOSIÇÃO</span><h2>Titulares × dependentes</h2></div></div>
            <div className="chart-area">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 12, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="holders" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4ab8ff" stopOpacity={0.35}/><stop offset="100%" stopColor="#4ab8ff" stopOpacity={0.02}/></linearGradient>
                      <linearGradient id="dependents" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#20d7ba" stopOpacity={0.35}/><stop offset="100%" stopColor="#20d7ba" stopOpacity={0.02}/></linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={25} />
                    <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={62} />
                    <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14 }} formatter={(value) => nf.format(Number(value ?? 0))} />
                    <Legend />
                    <Area type="monotone" dataKey="totalTitularesAtivos" name="Titulares" stroke="#4ab8ff" strokeWidth={2.5} fill="url(#holders)" />
                    <Area type="monotone" dataKey="totalDependentesAtivos" name="Dependentes" stroke="#20d7ba" strokeWidth={2.5} fill="url(#dependents)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="empty-chart">Ainda não há histórico suficiente para este gráfico.</div>}
            </div>
          </article>
        </section>

        <footer>Último snapshot armazenado: {dateTime(latest?.collectedAt)}</footer>
      </div>
    </main>
  );
}
