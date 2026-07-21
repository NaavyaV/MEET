import { NextRequest, NextResponse } from "next/server";
import { defaultProfile } from "@/src/lib/demo-data";
import { authenticatedUser, reserveRefreshQuota } from "@/src/lib/persistence";
import { runRefreshPipeline } from "@/src/lib/refresh-pipeline";
import { UserProfile } from "@/src/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { profile?: UserProfile };
  try {
    const user = await authenticatedUser(request.headers.get("authorization"));
    if (user) {
      const quota = await reserveRefreshQuota(user);
      if (quota && !quota.allowed) {
        return NextResponse.json({ error: "You have used today’s three refreshes. Your allowance resets at midnight Central.", resetAt: quota.reset_at, refreshesRemaining: quota.refreshes_remaining, groqTokensRemaining: quota.groq_tokens_remaining }, { status: 429 });
      }
    }
    return NextResponse.json(await runRefreshPipeline(body.profile ?? defaultProfile, user?.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The refresh pipeline could not complete." }, { status: 500 });
  }
}
