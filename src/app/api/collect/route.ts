import { NextResponse } from "next/server";
import { collectSnapshot } from "../../../lib/active-lives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json({ success: true, data: await collectSnapshot() });
  } catch (error) {
    console.error("[collect]", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao consultar vidas ativas." },
      { status: 502 }
    );
  }
}
