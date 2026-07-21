import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/src/lib/supabase";
import { EventAction, Opportunity } from "@/src/lib/types";

export const runtime = "nodejs";

type PreferenceRequest = {
  event?: Pick<Opportunity, "id" | "url">;
  action?: EventAction;
};

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

async function currentUser(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { admin: null, user: null, response: noStore(NextResponse.json({ error: "Supabase server credentials are not configured." }, { status: 503 })) };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { admin, user: null, response: noStore(NextResponse.json({ error: "Sign in to save this decision." }, { status: 401 })) };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { admin, user: null, response: noStore(NextResponse.json({ error: "Your session has expired. Sign in again to continue." }, { status: 401 })) };
  return { admin, user: data.user, response: null };
}

export async function GET(request: NextRequest) {
  try {
    const account = await currentUser(request);
    if (account.response || !account.admin || !account.user) return account.response!;
    const { data, error } = await account.admin.from("event_preferences").select("action, events!inner(external_id)").eq("user_id", account.user.id);
    if (error) throw new Error(error.message);
    const actions = Object.fromEntries((data ?? []).flatMap((row) => {
      const linkedEvent = row.events as { external_id?: string | null } | { external_id?: string | null }[] | null;
      const externalId = Array.isArray(linkedEvent) ? linkedEvent[0]?.external_id : linkedEvent?.external_id;
      return externalId && ["saved", "dismissed", "interested", "going"].includes(row.action) ? [[externalId, row.action]] : [];
    }));
    return noStore(NextResponse.json({ actions }));
  } catch (error) {
    return noStore(NextResponse.json({ error: error instanceof Error ? error.message : "Could not load saved event decisions." }, { status: 500 }));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const account = await currentUser(request);
    if (account.response || !account.admin || !account.user) return account.response!;

    const body = await request.json().catch(() => null) as PreferenceRequest | null;
    const event = body?.event;
    const action = body?.action;
    if (!event?.id || !event.url || !["saved", "dismissed", "interested", "going"].includes(action ?? "")) {
      return noStore(NextResponse.json({ error: "A valid event decision is required." }, { status: 400 }));
    }

    // Live pipeline persistence adds this suffix when it stores a card. Samples
    // intentionally have no database row and remain local-only.
    const canonicalUrl = `${event.url}#meet-${event.id}`;
    const { data: stored, error: eventError } = await account.admin.from("events").select("id").eq("canonical_url", canonicalUrl).maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (!stored) return noStore(NextResponse.json({ persisted: false, reason: "The event has not been stored yet." }));

    const { error: preferenceError } = await account.admin.from("event_preferences").upsert({ user_id: account.user.id, event_id: stored.id, action }, { onConflict: "user_id,event_id" });
    if (preferenceError) throw new Error(preferenceError.message);

    if (action === "going" || action === "interested") {
      const { error: attendanceError } = await account.admin.from("event_attendance").upsert({ user_id: account.user.id, event_id: stored.id, status: action }, { onConflict: "user_id,event_id" });
      if (attendanceError) throw new Error(attendanceError.message);
    } else {
      const { error: attendanceError } = await account.admin.from("event_attendance").delete().eq("user_id", account.user.id).eq("event_id", stored.id);
      if (attendanceError) throw new Error(attendanceError.message);
    }

    return noStore(NextResponse.json({ persisted: true }));
  } catch (error) {
    return noStore(NextResponse.json({ error: error instanceof Error ? error.message : "Could not save this decision." }, { status: 500 }));
  }
}
