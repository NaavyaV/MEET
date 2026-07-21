import { NextRequest, NextResponse } from "next/server";
import {
  digestFrequencyFrom,
  identityFromUser,
  PROFILE_SELECT,
  profileFromDatabaseRow,
  profileToDatabaseRow,
  sanitizeProfileInput,
} from "@/src/lib/account";
import { createSupabaseAdminClient } from "@/src/lib/supabase";

export const runtime = "nodejs";

type ProfileRequest = {
  profile?: unknown;
  digestFrequency?: unknown;
  completeOnboarding?: unknown;
};

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

async function currentAccount(request: NextRequest) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { admin: null, user: null, response: noStore(NextResponse.json({ error: "Supabase server credentials are not configured." }, { status: 503 })) };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { admin, user: null, response: noStore(NextResponse.json({ error: "Sign in to access your MEET profile." }, { status: 401 })) };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { admin, user: null, response: noStore(NextResponse.json({ error: "Your session has expired. Sign in again to continue." }, { status: 401 })) };
  return { admin, user: data.user, response: null };
}

async function readOrCreateProfile(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, user: NonNullable<Awaited<ReturnType<typeof currentAccount>>["user"]>) {
  const identity = identityFromUser(user);
  const { data: existing, error: existingError } = await admin.from("profiles").select(PROFILE_SELECT).eq("id", user.id).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing as Record<string, unknown>;

  const { data: inserted, error: insertError } = await admin.from("profiles").insert({ id: user.id, full_name: identity.name, digest_email: identity.email }).select(PROFILE_SELECT).single();
  if (!insertError && inserted) return inserted as Record<string, unknown>;

  // The auth trigger and this first profile request can race on a new account.
  // A conflicting insert is harmless; read the trigger-created profile once more.
  const { data: retried, error: retryError } = await admin.from("profiles").select(PROFILE_SELECT).eq("id", user.id).single();
  if (retryError || !retried) throw new Error(retryError?.message ?? insertError?.message ?? "Could not initialize your profile.");
  return retried as Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  try {
    const account = await currentAccount(request);
    if (account.response || !account.admin || !account.user) return account.response!;
    const row = await readOrCreateProfile(account.admin, account.user);
    return noStore(NextResponse.json(profileFromDatabaseRow(row, identityFromUser(account.user))));
  } catch (error) {
    return noStore(NextResponse.json({ error: error instanceof Error ? error.message : "Could not load your profile." }, { status: 500 }));
  }
}

async function saveProfile(request: NextRequest) {
  try {
    const account = await currentAccount(request);
    if (account.response || !account.admin || !account.user) return account.response!;
    const body = await request.json().catch(() => null) as ProfileRequest | null;
    if (!body || !body.profile) return noStore(NextResponse.json({ error: "A complete profile is required." }, { status: 400 }));
    const identity = identityFromUser(account.user);
    const parsed = sanitizeProfileInput(body.profile, identity.name);
    if (!parsed.profile) return noStore(NextResponse.json({ error: parsed.errors[0] ?? "Check your profile details and try again.", issues: parsed.errors }, { status: 422 }));
    const frequency = body.digestFrequency === undefined ? null : digestFrequencyFrom(body.digestFrequency);
    if (body.digestFrequency !== undefined && !frequency) return noStore(NextResponse.json({ error: "Choose daily, weekly, or on-demand digest delivery." }, { status: 422 }));

    const row = {
      id: account.user.id,
      ...profileToDatabaseRow(parsed.profile, parsed.digestEmail),
      ...(frequency ? { digest_frequency: frequency } : {}),
      ...(body.completeOnboarding === true ? { onboarding_completed: true } : {}),
    };
    const { data, error } = await account.admin.from("profiles").upsert(row, { onConflict: "id" }).select(PROFILE_SELECT).single();
    if (error || !data) throw new Error(error?.message ?? "Could not save your profile.");
    return noStore(NextResponse.json(profileFromDatabaseRow(data as Record<string, unknown>, identity)));
  } catch (error) {
    return noStore(NextResponse.json({ error: error instanceof Error ? error.message : "Could not save your profile." }, { status: 500 }));
  }
}

export async function PUT(request: NextRequest) {
  return saveProfile(request);
}

export async function PATCH(request: NextRequest) {
  return saveProfile(request);
}
