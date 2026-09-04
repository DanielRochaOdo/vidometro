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
  sampling: "day";
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

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
  day: "2-digit",
  month: "2-digit"
});

function fortalezaToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

function formatPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`;
}

function GrowthBadge({ growth }: { growth?: Growth | null }) {
  if (!growth || growth.percentage == null) return <span className="growth neutral">—</span>;
  const kind = growth.percentage > 0 ? "positive" : growth.percentage < 0 ? "negative" : "neutral";
  return (
    <span className={`growth ${kind}`}>
      {growth.percentage > 0 ? "↑" : growth.percentage < 0 ? "↓" : "•"} {formatPercent(growth.percentage)}
    </span>
  );
}

function BarsIcon() {
  return (
    <span className="brand-bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Dashboard() {
  const [today, setToday] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState("30");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  async function loadDashboard(nextFrom: string, nextTo: string, quiet = false) {
    if (!nextFrom || !nextTo) return;
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const { data: payload, error: rpcError } = await supabase.rpc("vidometro_dashboard", {
        p_from: nextFrom,
        p_to: nextTo
      });
      if (rpcError) throw rpcError;
      setData(payload as DashboardPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o Vidômetro.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem("vidometro-theme");
    const resolvedTheme = saved === "light" ? "light" : "dark";
    setTheme(resolvedTheme);
    document.documentElement.dataset.theme = resolvedTheme;

    const resolvedToday = fortalezaToday();
    const resolvedFrom = shiftIsoDate(resolvedToday, -29);
    setToday(resolvedToday);
    setFrom(resolvedFrom);
    setTo(resolvedToday);
    void loadDashboard(resolvedFrom, resolvedToday);
  }, []);

  useEffect(() => {
    if (!from || !to) return;
    const interval = window.setInterval(() => {
      void loadDashboard(from, to, true);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [from, to]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("vidometro-theme", next);
    document.documentElement.dataset.theme = next;
  }

  async function refreshNow() {
    if (!from || !to) return;
    setRefreshing(true);
    await loadDashboard(from, to, true);
    setRefreshing(false);
  }

  function changePreset(value: string) {
    setPreset(value);
    if (value === "custom" || !today) return;
    const days = Number(value);
    const nextFrom = shiftIsoDate(today, -(days - 1));
    setFrom(nextFrom);
    setTo(today);
    void loadDashboard(nextFrom, today);
  }

  const latest = data?.latest;
  const growth = data?.growth;
  const lastCollectedAt = latest ? new Date(latest.collectedAt).getTime() : 0;
  const online = Boolean(lastCollectedAt && Date.now() - lastCollectedAt < 15 * 60 * 1000);

  const chartData = (data?.trend ?? []).map((item) => ({
    ...item,
    label: shortDateFormatter.format(new Date(item.dataConsulta))
  }));

  const minLives = chartData.length
    ? Math.floor(Math.min(...chartData.map((item) => item.totalVidasAtivas)) / 100) * 100
    : 0;

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Vidômetro - início">
          <BarsIcon />
          <span>
            <strong>Vidômetro</strong>
            <small>Acompanhamento de Vidas Ativas</small>
          </span>
        </a>

        <nav className="nav" aria-label="Navegação principal">
          <a className="nav-active" href="#inicio">⌂ <span>Início</span></a>
          <a href="#historico">⌁ <span>Histórico</span></a>
          <a href="#sobre">ⓘ <span>Sobre</span></a>
          <span className={`status ${online ? "online" : "waiting"}`}>
            <i /> {online ? "Online" : "Aguardando"}
          </span>
          <button className="theme-button" type="button" onClick={toggleTheme} aria-label="Alternar tema">
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </nav>
      </header>

      <div className="content" id="inicio">
        {error && <div className="error-banner">{error}</div>}

        <section className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Odontoart Online</p>
            <h1>Vidas ativas,<br /><em>em tempo real.</em></h1>
            <p className="hero-description">
              Acompanhe a quantidade de vidas ativas do plano Odontoart de forma simples, visual e atualizada.
            </p>

            <div className="update-bar">
              <span className="clock">◷</span>
              <div>
                <small>Última consulta da API</small>
                <strong>{formatDateTime(latest?.dataConsulta)}</strong>
              </div>
              <button type="button" onClick={refreshNow} disabled={refreshing}>
                <span className={refreshing ? "spin" : ""}>↻</span>
                {refreshing ? "Atualizando..." : "Atualizar painel"}
              </button>
            </div>
          </div>

          <article className="primary-card">
            <div className="people-icon" aria-hidden="true">♟♟</div>
            <div className="primary-card-copy">
              <span>Vidas Ativas</span>
              <strong>{loading && !latest ? "—" : numberFormatter.format(latest?.totalVidasAtivas ?? 0)}</strong>
              <GrowthBadge growth={growth?.totalVidasAtivas} />
              <small>variação no período selecionado</small>
            </div>
          </article>
        </section>

        <section className="mini-metrics" aria-label="Composição das vidas ativas">
          <article>
            <span>Titulares ativos</span>
            <strong>{numberFormatter.format(latest?.totalTitularesAtivos ?? 0)}</strong>
            <GrowthBadge growth={growth?.totalTitularesAtivos} />
          </article>
          <article>
            <span>Dependentes ativos</span>
            <strong>{numberFormatter.format(latest?.totalDependentesAtivos ?? 0)}</strong>
            <GrowthBadge growth={growth?.totalDependentesAtivos} />
          </article>
          <article>
            <span>Data da consulta</span>
            <strong className="date-metric">{formatDateTime(latest?.dataConsulta)}</strong>
            <small>horário de Fortaleza</small>
          </article>
        </section>

        <section className="dashboard-grid" id="historico">
          <article className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <h2><span>⌁</span> Evolução de Vidas Ativas</h2>
                <small>Uma amostra por dia · última leitura diária</small>
              </div>
              <div className="period-controls">
                <select value={preset} onChange={(event) => changePreset(event.target.value)} aria-label="Período">
                  <option value="7">Últimos 7 dias</option>
                  <option value="30">Últimos 30 dias</option>
                  <option value="90">Últimos 90 dias</option>
                  <option value="custom">Personalizado</option>
                </select>
                {preset === "custom" && (
                  <div className="custom-dates">
                    <input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} />
                    <input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} />
                    <button type="button" onClick={() => void loadDashboard(from, to)}>Aplicar</button>
                  </div>
                )}
              </div>
            </div>

            <div className="chart-wrap">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 16, right: 18, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical stroke="var(--grid)" strokeDasharray="0" />
                    <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--grid)" }} minTickGap={24} />
                    <YAxis domain={[minLives, "auto"]} tickFormatter={(value) => numberFormatter.format(value)} tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} width={72} />
                    <Tooltip
                      contentStyle={{ background: "var(--tooltip)", border: "1px solid var(--border)", borderRadius: 12 }}
                      labelStyle={{ color: "var(--text)" }}
                      formatter={(value, name) => [numberFormatter.format(Number(value)), name]}
                    />
                    <Line type="monotone" dataKey="totalVidasAtivas" name="Vidas ativas" stroke="var(--green)" strokeWidth={3} dot={{ r: 3, fill: "var(--green)" }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="totalTitularesAtivos" name="Titulares" stroke="var(--blue)" strokeWidth={1.6} dot={false} opacity={0.8} />
                    <Line type="monotone" dataKey="totalDependentesAtivos" name="Dependentes" stroke="var(--cyan)" strokeWidth={1.6} dot={false} opacity={0.7} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">{loading ? "Carregando histórico..." : "Ainda não há amostras neste período."}</div>
              )}
            </div>
          </article>

          <aside className="side-column">
            <article className="panel summary-panel">
              <h2><BarsIcon /> Resumo</h2>
              <dl>
                <div><dt>Vidas Ativas (atual)</dt><dd>{numberFormatter.format(latest?.totalVidasAtivas ?? 0)}</dd></div>
                <div><dt>Variação (período)</dt><dd className={growth?.totalVidasAtivas.percentage != null && growth.totalVidasAtivas.percentage < 0 ? "down" : "up"}>{formatPercent(growth?.totalVidasAtivas.percentage)}</dd></div>
                <div><dt>Início do período</dt><dd>{numberFormatter.format(data?.first?.totalVidasAtivas ?? 0)}</dd></div>
                <div><dt>Fim do período</dt><dd>{numberFormatter.format(data?.last?.totalVidasAtivas ?? 0)}</dd></div>
                <div><dt>Dias com histórico</dt><dd>{data?.trend.length ?? 0}</dd></div>
              </dl>
            </article>

            <article className="panel recent-panel">
              <h2><span>◷</span> Últimos dias</h2>
              <div className="recent-list">
                {(data?.recent ?? []).map((item, index) => {
                  const previous = data?.recent[index + 1];
                  const pct = previous?.totalVidasAtivas
                    ? ((item.totalVidasAtivas - previous.totalVidasAtivas) / previous.totalVidasAtivas) * 100
                    : null;
                  return (
                    <div className="recent-row" key={`${item.collectedAt}-${index}`}>
                      <time>{formatDateTime(item.dataConsulta).replace(/\/\d{4},?\s?/, "")}</time>
                      <strong>{numberFormatter.format(item.totalVidasAtivas)}</strong>
                      <span className={pct != null && pct < 0 ? "down" : "up"}>{formatPercent(pct)}</span>
                    </div>
                  );
                })}
                {!data?.recent.length && <div className="empty-mini">Sem histórico diário ainda.</div>}
              </div>
            </article>
          </aside>
        </section>
      </div>

      <footer id="sobre">
        <div><strong>Vidômetro</strong><small>Dados atualizados automaticamente via Supabase</small></div>
        <span>♥ <small>Menos burocracia. Mais saúde.</small></span>
      </footer>
    </main>
  );
}
