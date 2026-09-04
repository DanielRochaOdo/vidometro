import { dbQuery } from "./db";

export const COLLECTION_INTERVAL_MS = 5 * 60 * 1000;
const FORTALEZA_OFFSET = "-03:00";
const FORTALEZA_TZ = "America/Fortaleza";

type DbSnapshot = {
  id: string;
  total_active_lives: number;
  total_active_holders: number;
  total_active_dependents: number;
  consulted_at: Date | string;
  collected_at: Date | string;
};

export type Snapshot = {
  id: string;
  totalVidasAtivas: number;
  totalTitularesAtivos: number;
  totalDependentesAtivos: number;
  dataConsulta: string;
  collectedAt: string;
};

export type Growth = { absolute: number; percentage: number | null };

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function serialize(row: DbSnapshot): Snapshot {
  return {
    id: String(row.id),
    totalVidasAtivas: Number(row.total_active_lives),
    totalTitularesAtivos: Number(row.total_active_holders),
    totalDependentesAtivos: Number(row.total_active_dependents),
    dataConsulta: toIso(row.consulted_at),
    collectedAt: toIso(row.collected_at)
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInteger(value: unknown, field: string) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Campo inválido retornado pela API: ${field}`);
  }
  return Math.trunc(parsed);
}

export function normalizeDataConsulta(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Campo inválido retornado pela API: dataConsulta");
  }

  const raw = value.trim();
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, day, month, year, hour = "00", minute = "00", second = "00"] = br;
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${FORTALEZA_OFFSET}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const isoWithoutZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw);
  const parsed = new Date(isoWithoutZone ? `${raw}${FORTALEZA_OFFSET}` : raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Campo inválido retornado pela API: dataConsulta");
  }
  return parsed.toISOString();
}

export function parseActiveLivesPayload(raw: unknown) {
  const root = asObject(raw);
  if (!root) throw new Error("Resposta inválida da API de vidas ativas.");

  const candidates = [root, asObject(root.data), asObject(root.result), asObject(root.payload)]
    .filter(Boolean) as Record<string, unknown>[];
  const payload = candidates.find((item) => "totalVidasAtivas" in item);
  if (!payload) throw new Error("A API não retornou totalVidasAtivas.");

  return {
    totalVidasAtivas: nonNegativeInteger(payload.totalVidasAtivas, "totalVidasAtivas"),
    totalTitularesAtivos: nonNegativeInteger(payload.totalTitularesAtivos, "totalTitularesAtivos"),
    totalDependentesAtivos: nonNegativeInteger(payload.totalDependentesAtivos, "totalDependentesAtivos"),
    dataConsulta: normalizeDataConsulta(payload.dataConsulta)
  };
}

function endpointUrl() {
  const configured = requiredEnv("VIDAS_ATIVAS_API_ENDPOINT");
  const token = requiredEnv("VIDAS_ATIVAS_API_TOKEN");
  let url: URL;

  try {
    const base = new URL(configured);
    url = base.pathname.includes("/v2/api/contratos/vidasAtivas")
      ? base
      : new URL("/v2/api/contratos/vidasAtivas", base);
  } catch {
    throw new Error("VIDAS_ATIVAS_API_ENDPOINT precisa ser uma URL válida.");
  }

  if (url.protocol !== "https:") {
    throw new Error("VIDAS_ATIVAS_API_ENDPOINT precisa usar HTTPS.");
  }
  url.searchParams.set("token", token);
  return url;
}

async function fetchCurrentLives() {
  const timeoutMs = Number(process.env.VIDAS_ATIVAS_API_TIMEOUT_MS ?? "15000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 15_000);

  try {
    const response = await fetch(endpointUrl(), {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`API Odontoart respondeu HTTP ${response.status}.`);
    return parseActiveLivesPayload(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Tempo limite excedido ao consultar a API Odontoart.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function latestSnapshot() {
  const result = await dbQuery<DbSnapshot>(
    `select id::text, total_active_lives, total_active_holders,
            total_active_dependents, consulted_at, collected_at
       from active_lives_snapshots
      order by collected_at desc, id desc
      limit 1`
  );
  return result.rows[0] ? serialize(result.rows[0]) : null;
}

export async function collectSnapshot(options: { force?: boolean } = {}) {
  const latest = await latestSnapshot();
  if (!options.force && latest) {
    const age = Date.now() - new Date(latest.collectedAt).getTime();
    if (age >= 0 && age < COLLECTION_INTERVAL_MS - 5_000) {
      return { snapshot: latest, collected: false, reason: "fresh" as const };
    }
  }

  const current = await fetchCurrentLives();
  const slot = Math.floor(Date.now() / COLLECTION_INTERVAL_MS);
  const result = await dbQuery<DbSnapshot>(
    `insert into active_lives_snapshots (
       collection_slot, total_active_lives, total_active_holders,
       total_active_dependents, consulted_at, collected_at
     ) values ($1, $2, $3, $4, $5::timestamptz, now())
     on conflict (collection_slot) do update set
       total_active_lives = excluded.total_active_lives,
       total_active_holders = excluded.total_active_holders,
       total_active_dependents = excluded.total_active_dependents,
       consulted_at = excluded.consulted_at,
       collected_at = now()
     returning id::text, total_active_lives, total_active_holders,
               total_active_dependents, consulted_at, collected_at`,
    [slot, current.totalVidasAtivas, current.totalTitularesAtivos,
      current.totalDependentesAtivos, current.dataConsulta]
  );

  return {
    snapshot: serialize(result.rows[0]),
    collected: true,
    reason: options.force ? ("manual" as const) : ("due" as const)
  };
}

function growth(first?: number, last?: number): Growth {
  if (first === undefined || last === undefined) return { absolute: 0, percentage: null };
  const absolute = last - first;
  return { absolute, percentage: first === 0 ? null : (absolute / first) * 100 };
}

async function boundarySnapshot(fromIso: string, toIso: string, direction: "asc" | "desc") {
  const result = await dbQuery<DbSnapshot>(
    `select id::text, total_active_lives, total_active_holders,
            total_active_dependents, consulted_at, collected_at
       from active_lives_snapshots
      where consulted_at >= $1::timestamptz and consulted_at < $2::timestamptz
      order by consulted_at ${direction}, id ${direction}
      limit 1`,
    [fromIso, toIso]
  );
  return result.rows[0] ? serialize(result.rows[0]) : null;
}

export async function dashboardData(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00${FORTALEZA_OFFSET}`);
  const toStart = new Date(`${to}T00:00:00${FORTALEZA_OFFSET}`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toStart.getTime()) || fromDate > toStart) {
    throw new Error("Período inválido.");
  }
  const toExclusive = new Date(toStart.getTime() + 86_400_000);
  const days = Math.round((toStart.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  const sampling: "hour" | "day" = days <= 3 ? "hour" : "day";
  const bucket = sampling === "hour"
    ? `date_trunc('hour', consulted_at at time zone '${FORTALEZA_TZ}')`
    : `date_trunc('day', consulted_at at time zone '${FORTALEZA_TZ}')`;

  const range = [fromDate.toISOString(), toExclusive.toISOString()];
  const [latest, first, last, trendResult] = await Promise.all([
    latestSnapshot(),
    boundarySnapshot(range[0], range[1], "asc"),
    boundarySnapshot(range[0], range[1], "desc"),
    dbQuery<DbSnapshot>(
      `select distinct on (bucket)
              id::text, total_active_lives, total_active_holders,
              total_active_dependents, consulted_at, collected_at, ${bucket} as bucket
         from active_lives_snapshots
        where consulted_at >= $1::timestamptz and consulted_at < $2::timestamptz
        order by bucket asc, consulted_at desc, id desc`,
      range
    )
  ]);

  return {
    latest,
    period: {
      from,
      to,
      first,
      last,
      growth: {
        totalVidasAtivas: growth(first?.totalVidasAtivas, last?.totalVidasAtivas),
        totalTitularesAtivos: growth(first?.totalTitularesAtivos, last?.totalTitularesAtivos),
        totalDependentesAtivos: growth(first?.totalDependentesAtivos, last?.totalDependentesAtivos)
      }
    },
    trend: trendResult.rows.map(serialize),
    sampling,
    collectionIntervalMinutes: 5
  };
}
