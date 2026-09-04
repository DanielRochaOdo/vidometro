import { createClient } from "npm:@supabase/supabase-js@2";

const MIN_COLLECTION_GAP_MS = 4 * 60 * 1000 + 30 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const API_PATH = "/v2/api/contratos/vidasAtivas";

type ApiSnapshot = {
  totalVidasAtivas: number;
  totalTitularesAtivos: number;
  totalDependentesAtivos: number;
  dataConsulta: string;
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

function secretKeys() {
  const keys = new Set<string>();
  const configured = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();

  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, string>;
      Object.values(parsed).forEach((value) => {
        if (typeof value === "string" && value.trim()) keys.add(value.trim());
      });
    } catch {
      throw new Error("SUPABASE_SECRET_KEYS possui formato inválido.");
    }
  }

  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) keys.add(legacy);

  if (!keys.size) {
    throw new Error("Nenhuma Secret Key do Supabase disponível na Edge Function.");
  }

  return keys;
}

function assertAuthorized(request: Request) {
  const apiKey = request.headers.get("apikey")?.trim();
  const expected = Deno.env.get("VIDOMETRO_COLLECTOR_SECRET")?.trim();

  if (!apiKey || !expected || apiKey !== expected) {
    throw new Error("UNAUTHORIZED");
  }
}

function adminKey() {
  const configured = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (configured) {
    const parsed = JSON.parse(configured) as Record<string, string>;
    const selected = parsed.default ?? Object.values(parsed)[0];
    if (selected) return selected;
  }

  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function resolveApiUrl() {
  const rawEndpoint = requiredEnv("VIDAS_ATIVAS_API_ENDPOINT");
  const token = requiredEnv("VIDAS_ATIVAS_API_TOKEN");
  const url = new URL(rawEndpoint);

  if (url.protocol !== "https:") {
    throw new Error("VIDAS_ATIVAS_API_ENDPOINT deve usar HTTPS.");
  }

  if (!url.pathname.includes(API_PATH)) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}${API_PATH}`;
  }

  url.searchParams.set("token", token);
  return url;
}

function asNonNegativeNumber(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const parsed = typeof normalized === "number" ? normalized : Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Campo inválido na API Odontoart: ${field}.`);
  }

  return Math.trunc(parsed);
}

function parseConsultedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Campo inválido na API Odontoart: dataConsulta.");
  }

  const raw = value.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (br) {
    const [, day, month, year, hour, minute, second = "00"] = br;
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const isoCandidate = hasZone ? raw : `${raw}-03:00`;
  const parsed = new Date(isoCandidate);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("dataConsulta retornada pela API não pôde ser interpretada.");
  }

  return parsed.toISOString();
}

function fortalezaDate(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(iso));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function unwrapPayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Resposta inválida da API Odontoart.");
  }

  const root = input as Record<string, unknown>;
  for (const key of ["data", "result", "payload"]) {
    const candidate = root[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }

  return root;
}

function parseApiSnapshot(input: unknown): ApiSnapshot {
  const payload = unwrapPayload(input);
  return {
    totalVidasAtivas: asNonNegativeNumber(payload.totalVidasAtivas, "totalVidasAtivas"),
    totalTitularesAtivos: asNonNegativeNumber(payload.totalTitularesAtivos, "totalTitularesAtivos"),
    totalDependentesAtivos: asNonNegativeNumber(payload.totalDependentesAtivos, "totalDependentesAtivos"),
    dataConsulta: parseConsultedAt(payload.dataConsulta)
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { success: false, error: "Método não permitido." });
  }

  try {
    assertAuthorized(request);

    const supabase = createClient(requiredEnv("SUPABASE_URL"), adminKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Protege a API Odontoart contra chamadas repetidas fora da cadência do cron.
    // Isso não cria registros extras: a tabela continua tendo uma única linha por dia.
    const { data: latest, error: latestError } = await supabase
      .from("active_lives_snapshots")
      .select("total_active_lives,total_active_holders,total_active_dependents,consulted_at,collected_at")
      .order("collected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) throw latestError;

    if (latest) {
      const ageMs = Date.now() - new Date(latest.collected_at).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < MIN_COLLECTION_GAP_MS) {
        return jsonResponse(200, {
          success: true,
          collected: false,
          reason: "recent_collection",
          data: {
            totalVidasAtivas: latest.total_active_lives,
            totalTitularesAtivos: latest.total_active_holders,
            totalDependentesAtivos: latest.total_active_dependents,
            dataConsulta: latest.consulted_at,
            collectedAt: latest.collected_at
          }
        });
      }
    }

    const configuredTimeout = Number(Deno.env.get("VIDAS_ATIVAS_API_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let apiResponse: Response;
    try {
      apiResponse = await fetch(resolveApiUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store"
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!apiResponse.ok) {
      throw new Error(`API Odontoart respondeu HTTP ${apiResponse.status}.`);
    }

    const snapshot = parseApiSnapshot(await apiResponse.json());
    const collectedAt = new Date().toISOString();
    const collectionDate = fortalezaDate(snapshot.dataConsulta);

    // Uma única linha por dia: cada leitura substitui os valores daquele dia.
    // Ao final do dia, a linha representa exatamente a última leitura realizada.
    const { data: stored, error: insertError } = await supabase
      .from("active_lives_snapshots")
      .upsert(
        {
          collection_date: collectionDate,
          total_active_lives: snapshot.totalVidasAtivas,
          total_active_holders: snapshot.totalTitularesAtivos,
          total_active_dependents: snapshot.totalDependentesAtivos,
          consulted_at: snapshot.dataConsulta,
          collected_at: collectedAt
        },
        { onConflict: "collection_date" }
      )
      .select("total_active_lives,total_active_holders,total_active_dependents,consulted_at,collected_at")
      .single();

    if (insertError) throw insertError;

    return jsonResponse(200, {
      success: true,
      collected: true,
      data: {
        totalVidasAtivas: stored.total_active_lives,
        totalTitularesAtivos: stored.total_active_holders,
        totalDependentesAtivos: stored.total_active_dependents,
        dataConsulta: stored.consulted_at,
        collectedAt: stored.collected_at
      }
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Falha inesperada na coleta.";
    if (message === "UNAUTHORIZED") {
      return jsonResponse(401, { success: false, error: "Não autorizado." });
    }
    console.error("Vidometro collector:", message);
    return jsonResponse(502, { success: false, error: message });
  }
});
