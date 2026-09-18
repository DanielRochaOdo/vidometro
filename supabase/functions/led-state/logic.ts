export type LedTrend = "up" | "down" | "flat";

export type RealtimeSample = {
  id: number | string;
  total_active_lives: number;
  consulted_at: string;
  collected_at: string;
};

export type LedStatePayload = {
  vidas: number;
  trend: LedTrend;
  version: string;
  source_updated_at: string;
};

export function calculateTrend(current: number, previous?: number | null): LedTrend {
  if (previous == null || current === previous) return "flat";
  return current > previous ? "up" : "down";
}

function normalizeLives(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Invalid active-lives sample.");
  }
  return Math.trunc(parsed);
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid source timestamp.");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid source timestamp.");
  }

  return parsed.toISOString();
}

export function buildLedState(samples: RealtimeSample[]): LedStatePayload | null {
  const current = samples[0];
  if (!current) return null;

  const previous = samples[1];
  const vidas = normalizeLives(current.total_active_lives);
  const previousLives = previous ? normalizeLives(previous.total_active_lives) : null;
  const version = String(current.id);

  if (!version) {
    throw new Error("Invalid sample version.");
  }

  return {
    vidas,
    trend: calculateTrend(vidas, previousLives),
    version,
    source_updated_at: normalizeTimestamp(current.consulted_at)
  };
}

export function extractBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = match?.[1]?.trim();
  return token || null;
}

async function sha256(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  );
}

export async function secureTokenEquals(provided: string, expected: string) {
  const [providedHash, expectedHash] = await Promise.all([
    sha256(provided),
    sha256(expected)
  ]);

  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= providedHash[index] ^ expectedHash[index];
  }

  return difference === 0;
}

export async function isAuthorized(request: Request, expectedToken: string) {
  const providedToken = extractBearerToken(request);
  if (!providedToken || !expectedToken) return false;
  return secureTokenEquals(providedToken, expectedToken);
}
