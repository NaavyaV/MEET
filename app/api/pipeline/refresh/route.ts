import { NextRequest, NextResponse } from "next/server";
import { defaultProfile } from "@/src/lib/demo-data";
import { authenticatedUserId } from "@/src/lib/persistence";
import { runRefreshPipeline } from "@/src/lib/refresh-pipeline";
import { UserProfile } from "@/src/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { profile?: UserProfile };
  try {
    const userId = await authenticatedUserId(request.headers.get("authorization"));
    return NextResponse.json(await runRefreshPipeline(body.profile ?? defaultProfile, userId ?? undefined));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The refresh pipeline could not complete." }, { status: 500 });
  }
}
