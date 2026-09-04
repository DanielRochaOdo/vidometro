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

type SavedPreferences = {
  preset?: Preset;
  from?: string;
  to?: string;
};

const PREFERENCES_KEY = "vidometro-dashboard-preferences";
const VALID_PRESETS = new Set<Preset>(["realtime", "1", "7", "30", "90", "custom"]);
const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});
const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
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
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3
  })}%`;
}

function formatShare(part: number, total: number) {
  if (!total) return "—";
  return `${((part / total) * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}% do total`;
}

function MetricDelta({ growth }: { growth?: Growth | null }) {
  const percentage = growth?.percentage;
  const kind = percentage == null || percentage === 0 ? "neutral" : percentage > 0 ? "positive" : "negative";
  const icon = percentage == null || percentage === 0 ? "remove" : percentage > 0 ? "arrow_upward" : "arrow_downward";

  return (
    <span className={`delta-chip ${kind}`}>
      <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
      {formatPercent(percentage)}
    </span>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
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
  const [preset, setPreset] = useState<Preset>("30");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  async function loadTelemetry(mode: Preset, nextFrom: string, nextTo: string, quiet = false) {
    if (!nextFrom || !nextTo) return;
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const result = mode === "realtime"
        ? await supabase.rpc("vidometro_realtime")
        : await supabase.rpc("vidometro_dashboard", {
            p_from: nextFrom,
            p_to: nextTo
          });

      if (result.error) throw result.error;
      setData(result.data as DashboardPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o Vidômetro.");
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
      if (saved?.preset && VALID_PRESETS.has(saved.preset)) {
        resolvedPreset = saved.preset;
      }

      if (resolvedPreset === "custom") {
        if (isIsoDate(saved?.from) && isIsoDate(saved?.to) && saved!.from! <= saved!.to!) {
          resolvedFrom = saved!.from!;
          resolvedTo = saved!.to!;
        } else {
          resolvedPreset = "30";
        }
      }
    } catch {
      localStorage.removeItem(PREFERENCES_KEY);
    }

    if (resolvedPreset === "realtime" || resolvedPreset === "1") {
      resolvedFrom = resolvedToday;
      resolvedTo = resolvedToday;
    } else if (resolvedPreset !== "custom") {
      const days = Number(resolvedPreset);
      resolvedFrom = shiftIsoDate(resolvedToday, -(days - 1));
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
    const preferences: SavedPreferences = { preset, from, to };
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferencesReady, preset, from, to]);

  useEffect(() => {
    if (!preferencesReady || !from || !to) return;
    const interval = window.setInterval(() => {
      void loadTelemetry(preset, from, to, true);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [preferencesReady, preset, from, to]);

  useEffect(() => {
    if (!preferencesReady || !from || !to) return;

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`vidometro-active-lives-${preset}-${from}-${to}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "active_lives_realtime_samples"
        },
        () => {
          void loadTelemetry(preset, from, to, true);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [preferencesReady, preset, from, to]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("vidometro-theme", next);
    document.documentElement.dataset.theme = next;
  }

  async function refreshNow() {
    if (!from || !to) return;
    setRefreshing(true);
    await loadTelemetry(preset, from, to, true);
    setRefreshing(false);
  }

  function changePreset(value: Preset) {
    setPreset(value);
    if (value === "custom" || !today) return;

    const nextFrom = value === "realtime" || value === "1"
      ? today
      : shiftIsoDate(today, -(Number(value) - 1));

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

  const chartData = (data?.trend ?? []).map((item) => ({
    ...item,
    label: realtimeMode
      ? formatTime(item.dataConsulta)
      : preset === "1"
        ? "Hoje"
        : shortDateFormatter.format(new Date(item.dataConsulta))
  }));

  const allChartValues = chartData.flatMap((item) => [
    item.totalVidasAtivas,
    item.totalTitularesAtivos,
    item.totalDependentesAtivos
  ]);
  const minLives = allChartValues.length
    ? Math.max(0, Math.floor(Math.min(...allChartValues) / 1000) * 1000)
    : 0;

  const chartDescription = realtimeMode
    ? "Uma amostra por ciclo de coleta · atualização aproximada a cada 5 minutos"
    : preset === "1"
      ? "Hoje · última leitura diária consolidada"
      : "Uma amostra por dia · última leitura diária";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-left">
            <a className="brand" href="#inicio" aria-label="Vidômetro - início">
              <BrandMark />
              <span className="brand-copy">
                <span className="brand-title-row">
                  <strong>Vidômetro</strong>
                  <em>Odontoart</em>
                </span>
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
            <span className={`live-pill ${online ? "online" : "waiting"}`}>
              <i><b /></i>
              {online ? "Online" : "Aguardando"}
            </span>
            <button className="icon-button" type="button" onClick={toggleTheme} aria-label="Alternar tema">
              <span className="material-symbols-outlined" aria-hidden="true">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
            </button>
            <span className="profile-chip" aria-hidden="true">
              <span className="material-symbols-outlined">person</span>
            </span>
          </div>
        </div>
      </header>

      <main className="dashboard-main" id="inicio">
        <div className="dashboard-container">
          {error && (
            <div className="error-banner" role="alert">
              <span className="material-symbols-outlined" aria-hidden="true">warning</span>
              <span>{error}</span>
            </div>
          )}

          <section className="hero-section" aria-labelledby="hero-title">
            <div className="hero-copy">
              <div className="hero-kicker-row">
                <span className="telemetry-chip"><i /> Odontoart Online</span>
                <span className="production-label">Telemetria em Produção</span>
              </div>

              <div>
                <h1 id="hero-title">Vidas ativas,<br /><em>em tempo real.</em></h1>
                <p>
                  Acompanhe a quantidade de vidas ativas do plano Odontoart de forma simples,
                  visual e atualizada.
                </p>
              </div>

              <div className="sync-card">
                <div className="sync-info">
                  <span className="sync-icon material-symbols-outlined" aria-hidden="true">schedule</span>
                  <span>
                    <small>Última consulta da API</small>
                    <strong>{formatDateTime(latest?.dataConsulta)}</strong>
                  </span>
                </div>
                <button className="refresh-button" type="button" onClick={refreshNow} disabled={refreshing}>
                  <span className={`material-symbols-outlined ${refreshing ? "spin" : ""}`} aria-hidden="true">sync</span>
                  {refreshing ? "Atualizando..." : "Atualizar painel"}
                </button>
              </div>
            </div>

            <article className="hero-metric-card">
              <div className="hero-glow" aria-hidden="true" />
              <div className="hero-metric-header">
                <div className="metric-title-group">
                  <span className="metric-icon-large material-symbols-outlined" aria-hidden="true">groups</span>
                  <span>
                    <small>Métrica Consolidada</small>
                    <strong>Vidas Ativas</strong>
                  </span>
                </div>
                <MetricDelta growth={growth?.totalVidasAtivas} />
              </div>

              <div className="hero-number-block">
                <strong>{loading && !latest ? "—" : numberFormatter.format(totalLives)}</strong>
                <small><i /> {realtimeMode ? "variação em relação ao ciclo anterior" : "variação no período selecionado"}</small>
              </div>

              <div className="hero-metric-footer">
                <span><i /> Total Carteira Ativa</span>
                <strong>{latest ? "100% elegíveis" : "Aguardando leitura"}</strong>
              </div>
            </article>
          </section>

          <section className="metric-strip" aria-label="Composição das vidas ativas">
            <article className="mini-card holders-card">
              <div className="mini-card-top">
                <span className="mini-card-label">
                  <i className="material-symbols-outlined" aria-hidden="true">badge</i>
                  Titulares ativos
                </span>
                <MetricDelta growth={growth?.totalTitularesAtivos} />
              </div>
              <div className="mini-card-value">
                <strong>{numberFormatter.format(holders)}</strong>
                <small>{formatShare(holders, totalLives)}</small>
              </div>
            </article>

            <article className="mini-card dependents-card">
              <div className="mini-card-top">
                <span className="mini-card-label">
                  <i className="material-symbols-outlined" aria-hidden="true">family_restroom</i>
                  Dependentes ativos
                </span>
                <MetricDelta growth={growth?.totalDependentesAtivos} />
              </div>
              <div className="mini-card-value">
                <strong>{numberFormatter.format(dependents)}</strong>
                <small>{formatShare(dependents, totalLives)}</small>
              </div>
            </article>

            <article className="mini-card date-card">
              <div className="mini-card-top">
                <span className="mini-card-label">
                  <i className="material-symbols-outlined" aria-hidden="true">calendar_today</i>
                  Data da consulta
                </span>
                <span className="timezone-label">UTC-3</span>
              </div>
              <div className="mini-card-value date-value">
                <strong>{formatDateTime(latest?.dataConsulta)}</strong>
                <small>horário de Fortaleza</small>
              </div>
            </article>
          </section>

          <section className="analytics-grid" id="historico">
            <article className="analytics-card chart-card">
              <div className="analytics-heading">
                <div>
                  <div className="section-title">
                    <span className="material-symbols-outlined" aria-hidden="true">show_chart</span>
                    <h2>Evolução de Vidas Ativas</h2>
                  </div>
                  <p>{chartDescription}</p>
                </div>

                <div className="range-switch" aria-label="Período do histórico">
                  {[
                    ["realtime", "Realtime"],
                    ["1", "1 dia"],
                    ["7", "7 dias"],
                    ["30", "Últimos 30 dias"],
                    ["90", "90 dias"],
                    ["custom", "Personalizado"]
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={preset === value ? "active" : ""}
                      type="button"
                      onClick={() => changePreset(value as Preset)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {preset === "custom" && (
                <div className="custom-range">
                  <label>
                    <span>De</span>
                    <input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} />
                  </label>
                  <label>
                    <span>Até</span>
                    <input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} />
                  </label>
                  <button type="button" onClick={() => void loadTelemetry("custom", from, to)}>Aplicar período</button>
                </div>
              )}

              <div className="chart-legend" aria-label="Séries do gráfico">
                <span><i className="total" />Vidas ativas (Total)</span>
                <span><i className="dependents" />Dependentes ({numberFormatter.format(dependents)})</span>
                <span><i className="holders" />Titulares ({numberFormatter.format(holders)})</span>
              </div>

              <div className="chart-surface">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 18, right: 20, left: 2, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "var(--chart-grid-strong)" }}
                        minTickGap={realtimeMode ? 18 : 24}
                      />
                      <YAxis
                        domain={[minLives, "auto"]}
                        tickFormatter={(value) => numberFormatter.format(value)}
                        tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={74}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--tooltip)",
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          boxShadow: "0 14px 30px rgba(0,0,0,.35)"
                        }}
                        labelStyle={{ color: "var(--text)" }}
                        formatter={(value, name) => [numberFormatter.format(Number(value)), name]}
                      />
                      <Line
                        type="monotone"
                        dataKey="totalVidasAtivas"
                        name="Vidas ativas"
                        stroke="var(--green)"
                        strokeWidth={3.5}
                        dot={{ r: realtimeMode ? 2.5 : 3.5, fill: "var(--chart-surface)", stroke: "var(--green)", strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="totalDependentesAtivos"
                        name="Dependentes"
                        stroke="var(--blue)"
                        strokeWidth={2.2}
                        dot={realtimeMode || preset === "1" ? { r: 3, fill: "var(--chart-surface)", stroke: "var(--blue)", strokeWidth: 2 } : false}
                      />
                      <Line
                        type="monotone"
                        dataKey="totalTitularesAtivos"
                        name="Titulares"
                        stroke="var(--cyan)"
                        strokeWidth={2.2}
                        dot={realtimeMode || preset === "1" ? { r: 3, fill: "var(--chart-surface)", stroke: "var(--cyan)", strokeWidth: 2 } : false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">
                    <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
                    <strong>{loading ? "Carregando histórico..." : realtimeMode ? "Aguardando o primeiro ciclo realtime." : "Ainda não há amostras neste período."}</strong>
                    <small>{realtimeMode ? "As amostras surgem automaticamente a cada coleta da API." : "O histórico mantém uma única leitura consolidada por dia."}</small>
                  </div>
                )}
              </div>

              <div className="chart-footnote">
                <span>{realtimeMode ? "Realtime mantém apenas a janela operacional recente; o histórico oficial continua diário." : preset === "1" ? "Exibindo a leitura consolidada de hoje." : "Histórico diário preservando a última leitura de cada data."}</span>
                <span className="verified"><i className="material-symbols-outlined" aria-hidden="true">verified</i> Sincronização automática</span>
              </div>
            </article>

            <aside className="side-column">
              <article className="side-card summary-card">
                <div className="side-card-heading">
                  <span>
                    <i className="material-symbols-outlined" aria-hidden="true">analytics</i>
                    <strong>Resumo</strong>
                  </span>
                  <small>{realtimeMode ? "Realtime" : "Período atual"}</small>
                </div>
                <dl>
                  <div><dt>Vidas Ativas (atual)</dt><dd>{numberFormatter.format(totalLives)}</dd></div>
                  <div><dt>{realtimeMode ? "Variação (último ciclo)" : "Variação (período)"}</dt><dd><MetricDelta growth={growth?.totalVidasAtivas} /></dd></div>
                  <div><dt>{realtimeMode ? "Primeiro ciclo do dia" : "Início do período"}</dt><dd>{numberFormatter.format(data?.first?.totalVidasAtivas ?? 0)}</dd></div>
                  <div><dt>{realtimeMode ? "Último ciclo" : "Fim do período"}</dt><dd>{numberFormatter.format(data?.last?.totalVidasAtivas ?? 0)}</dd></div>
                  <div><dt>{realtimeMode ? "Ciclos no gráfico" : "Dias com histórico"}</dt><dd className="secondary-value">{data?.trend.length ?? 0}</dd></div>
                </dl>
              </article>

              <article className="side-card recent-card">
                <div className="side-card-heading">
                  <span>
                    <i className="material-symbols-outlined cyan" aria-hidden="true">history_toggle_off</i>
                    <strong>Últimos dias</strong>
                  </span>
                  <i className={`activity-dot ${online ? "online" : ""}`} />
                </div>

                <div className="recent-list">
                  {(data?.recent ?? []).map((item, index) => {
                    const previous = data?.recent[index + 1];
                    const pct = previous?.totalVidasAtivas
                      ? ((item.totalVidasAtivas - previous.totalVidasAtivas) / previous.totalVidasAtivas) * 100
                      : null;
                    return (
                      <div className="recent-row" key={`${item.collectedAt}-${index}`}>
                        <div className="recent-date">
                          <i />
                          <span>
                            <strong>{formatDate(item.dataConsulta)}</strong>
                            <small>{formatTime(item.dataConsulta)} · Atualização API</small>
                          </span>
                        </div>
                        <div className="recent-values">
                          <strong>{numberFormatter.format(item.totalVidasAtivas)}</strong>
                          <span className={pct != null && pct < 0 ? "negative" : pct != null ? "positive" : "neutral"}>{formatPercent(pct)}</span>
                        </div>
                      </div>
                    );
                  })}

                  {!data?.recent.length && (
                    <div className="recent-empty">
                      <span className="material-symbols-outlined" aria-hidden="true">inventory_2</span>
                      <p>Sem histórico diário ainda.</p>
                    </div>
                  )}
                </div>

                <div className="daily-note">
                  <span className="material-symbols-outlined" aria-hidden="true">info</span>
                  Uma linha por dia, sempre atualizada com a leitura mais recente.
                </div>
              </article>
            </aside>
          </section>

          <section className="about-card" id="sobre">
            <span className="material-symbols-outlined" aria-hidden="true">database</span>
            <div>
              <strong>Telemetria operacional Odontoart</strong>
              <p>O Vidômetro combina histórico diário consolidado com uma janela realtime de cada ciclo de coleta e atualiza o painel automaticamente após novas leituras.</p>
            </div>
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-inner">
          <span>
            <strong>Vidômetro</strong>
            <small>Dados atualizados automaticamente via Supabase</small>
          </span>
          <span className="footer-message"><i>♥</i> Menos burocracia. Mais saúde.</span>
        </div>
      </footer>
    </div>
  );
}
