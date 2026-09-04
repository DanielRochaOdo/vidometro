import { NextResponse } from "next/server";
import { collectSnapshot } from "../../../../lib/active-lives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET não configurado." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Não autorizado." }, { status: 401 });
  }

  try {
    return NextResponse.json({ success: true, data: await collectSnapshot() });
  } catch (error) {
    console.error("[cron/collect]", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao consultar vidas ativas." },
      { status: 502 }
    );
  }
}
