import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const destination = safeNext(url.searchParams.get("next"));
  const redirectUrl = new URL(destination, url.origin);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const code = url.searchParams.get("code");

  if (!supabaseUrl || !publishableKey || !code) return NextResponse.redirect(redirectUrl);

  let response = NextResponse.redirect(redirectUrl);
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.redirect(redirectUrl);
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const errorUrl = new URL(destination, url.origin);
    errorUrl.searchParams.set("authError", "Your sign-in link is invalid or has expired. Request a new one.");
    return NextResponse.redirect(errorUrl);
  }
  return response;
}
