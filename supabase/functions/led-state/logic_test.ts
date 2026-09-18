import {
  buildLedState,
  calculateTrend,
  isAuthorized,
  type RealtimeSample
} from "./logic.ts";

function assertEquals<T>(actual: T, expected: T, label: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
  }
}

function sample(
  id: number,
  vidas: number,
  consultedAt = "2026-09-18T11:20:03.000Z"
): RealtimeSample {
  return {
    id,
    total_active_lives: vidas,
    consulted_at: consultedAt,
    collected_at: consultedAt
  };
}

Deno.test("trend up", () => {
  assertEquals(calculateTrend(202113, 202100), "up", "trend");
});

Deno.test("trend down", () => {
  assertEquals(calculateTrend(202113, 202120), "down", "trend");
});

Deno.test("trend flat", () => {
  assertEquals(calculateTrend(202113, 202113), "flat", "trend");
});

Deno.test("uma leitura usa trend flat", () => {
  const state = buildLedState([sample(10, 202113)]);
  assertEquals(state?.vidas, 202113, "vidas");
  assertEquals(state?.trend, "flat", "trend");
});

Deno.test("sem leituras retorna null", () => {
  assertEquals(buildLedState([]), null, "state");
});

Deno.test("version permanece estável sem nova leitura", () => {
  const samples = [sample(11, 202113), sample(10, 202100)];
  const first = buildLedState(samples);
  const second = buildLedState(samples);
  assertEquals(first?.version, second?.version, "version");
});

Deno.test("nova leitura altera version", () => {
  const first = buildLedState([sample(11, 202113), sample(10, 202100)]);
  const second = buildLedState([
    sample(12, 202120, "2026-09-18T11:25:03.000Z"),
    sample(11, 202113)
  ]);
  if (first?.version === second?.version) {
    throw new Error("version deveria mudar quando a leitura canônica muda");
  }
});

Deno.test("token ausente não autoriza", async () => {
  const request = new Request("https://example.test/functions/v1/led-state");
  assertEquals(await isAuthorized(request, "segredo-de-teste"), false, "authorization");
});

Deno.test("token incorreto não autoriza", async () => {
  const request = new Request("https://example.test/functions/v1/led-state", {
    headers: { Authorization: "Bearer incorreto" }
  });
  assertEquals(await isAuthorized(request, "segredo-de-teste"), false, "authorization");
});

Deno.test("token correto autoriza", async () => {
  const request = new Request("https://example.test/functions/v1/led-state", {
    headers: { Authorization: "Bearer segredo-de-teste" }
  });
  assertEquals(await isAuthorized(request, "segredo-de-teste"), true, "authorization");
});
