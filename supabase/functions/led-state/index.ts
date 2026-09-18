import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildLedState,
  isAuthorized,
  type RealtimeSample
} from "./logic.ts";

function jsonResponse(status: number, body: unknown, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
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

Deno.serve(async (request) => {
  if (request.method !== "GET") {
    return jsonResponse(
      405,
      { error: "method_not_allowed" },
      { Allow: "GET" }
    );
  }

  const expectedToken = Deno.env.get("LED_AGENT_TOKEN")?.trim();
  if (!expectedToken) {
    console.error("Vidometro led-state: LED_AGENT_TOKEN não configurado.");
    return jsonResponse(500, { error: "internal_error" });
  }

  if (!(await isAuthorized(request, expectedToken))) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  try {
    const supabase = createClient(requiredEnv("SUPABASE_URL"), adminKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { data, error } = await supabase
      .from("active_lives_realtime_samples")
      .select("id,total_active_lives,consulted_at,collected_at")
      .order("collected_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(2);

    if (error) throw error;

    const state = buildLedState((data ?? []) as RealtimeSample[]);
    if (!state) {
      return jsonResponse(503, { error: "state_unavailable" });
    }

    return jsonResponse(200, state);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unexpected error";
    console.error("Vidometro led-state:", message);
    return jsonResponse(500, { error: "internal_error" });
  }
});
