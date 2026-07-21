import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/src/lib/supabase";

export const runtime = "nodejs";

type NetworkMutation = { connectionId?: unknown; status?: unknown };

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

async function currentAccount(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { admin: null, user: null, response: noStore(NextResponse.json({ error: "Supabase server credentials are not configured." }, { status: 503 })) };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { admin, user: null, response: noStore(NextResponse.json({ error: "Sign in to use your network." }, { status: 401 })) };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { admin, user: null, response: noStore(NextResponse.json({ error: "Your session has expired. Sign in again to continue." }, { status: 401 })) };
  return { admin, user: data.user, response: null };
}

export async function GET(request: NextRequest) {
  try {
    const account = await currentAccount(request);
    if (account.response || !account.admin || !account.user) return account.response!;
    const { data: rows, error } = await account.admin
      .from("connections")
      .select("id, requester_id, addressee_id, status, created_at")
      .or(`requester_id.eq.${account.user.id},addressee_id.eq.${account.user.id}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const otherIds = [...new Set((rows ?? []).map((row) => row.requester_id === account.user.id ? row.addressee_id : row.requester_id))];
    const { data: profiles, error: profilesError } = otherIds.length
      ? await account.admin.from("profiles").select("id, full_name, username, avatar_url").in("id", otherIds)
      : { data: [], error: null };
    if (profilesError) throw new Error(profilesError.message);
    const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const connections = (rows ?? []).flatMap((row) => {
      const otherId = row.requester_id === account.user.id ? row.addressee_id : row.requester_id;
      const profile = byId.get(otherId);
      if (!profile) return [];
      return [{ id: row.id, status: row.status, direction: row.requester_id === account.user.id ? "sent" : "received", createdAt: row.created_at, person: { id: profile.id, fullName: profile.full_name || profile.username || "MEET member", username: profile.username, avatarUrl: profile.avatar_url } }];
    });
    return noStore(NextResponse.json({ connections }));
  } catch (error) {
    return noStore(NextResponse.json({ error: error instanceof Error ? error.message : "Could not load your network." }, { status: 500 }));
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const account = await currentAccount(request);
    if (account.response || !account.admin || !account.user) return account.response!;
    const body = await request.json().catch(() => null) as NetworkMutation | null;
    if (typeof body?.connectionId !== "string" || body.status !== "accepted") return noStore(NextResponse.json({ error: "A pending connection is required." }, { status: 400 }));
    const { data, error } = await account.admin.from("connections").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", body.connectionId).eq("addressee_id", account.user.id).eq("status", "pending").select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return noStore(NextResponse.json({ error: "That request is no longer available." }, { status: 404 }));
    return noStore(NextResponse.json({ connectionId: data.id, status: "accepted" }));
  } catch (error) {
    return noStore(NextResponse.json({ error: error instanceof Error ? error.message : "Could not accept that connection." }, { status: 500 }));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const account = await currentAccount(request);
    if (account.response || !account.admin || !account.user) return account.response!;
    const body = await request.json().catch(() => null) as NetworkMutation | null;
    if (typeof body?.connectionId !== "string") return noStore(NextResponse.json({ error: "A connection is required." }, { status: 400 }));
    const { data, error } = await account.admin.from("connections").delete().eq("id", body.connectionId).or(`requester_id.eq.${account.user.id},addressee_id.eq.${account.user.id}`).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return noStore(NextResponse.json({ error: "That connection is no longer available." }, { status: 404 }));
    return noStore(NextResponse.json({ removed: data.id }));
  } catch (error) {
    return noStore(NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove that connection." }, { status: 500 }));
  }
}
