import { NextResponse } from "next/server";
import { z } from "zod";
import { dashboardData } from "../../../lib/active-lives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({ from: date, to: date }).refine((value) => value.from <= value.to);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = query.safeParse({ from: params.get("from"), to: params.get("to") });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Período inválido." }, { status: 400 });
  }

  try {
    return NextResponse.json({ success: true, data: await dashboardData(parsed.data.from, parsed.data.to) });
  } catch (error) {
    console.error("[dashboard]", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao carregar dados." },
      { status: 500 }
    );
  }
}
