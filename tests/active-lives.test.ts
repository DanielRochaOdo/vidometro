import { describe, expect, it } from "vitest";
import { normalizeDataConsulta, parseActiveLivesPayload } from "../src/lib/active-lives";

describe("vidas ativas", () => {
  it("interpreta o contrato principal da API", () => {
    expect(parseActiveLivesPayload({
      totalVidasAtivas: 12000,
      totalTitularesAtivos: 7000,
      totalDependentesAtivos: 5000,
      dataConsulta: "04/09/2026 11:30:00"
    })).toEqual({
      totalVidasAtivas: 12000,
      totalTitularesAtivos: 7000,
      totalDependentesAtivos: 5000,
      dataConsulta: "2026-09-04T14:30:00.000Z"
    });
  });

  it("aceita wrapper data e valores numéricos em string", () => {
    expect(parseActiveLivesPayload({ data: {
      totalVidasAtivas: "100",
      totalTitularesAtivos: "60",
      totalDependentesAtivos: "40",
      dataConsulta: "2026-09-04T11:35:00-03:00"
    }})).toMatchObject({ totalVidasAtivas: 100, totalTitularesAtivos: 60, totalDependentesAtivos: 40 });
  });

  it("assume Fortaleza quando o ISO não traz fuso", () => {
    expect(normalizeDataConsulta("2026-09-04T11:40:00")).toBe("2026-09-04T14:40:00.000Z");
  });

  it("rejeita resposta sem totalVidasAtivas", () => {
    expect(() => parseActiveLivesPayload({ dataConsulta: "04/09/2026" })).toThrow("totalVidasAtivas");
  });
});
