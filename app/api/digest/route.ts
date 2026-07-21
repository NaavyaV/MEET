import { NextRequest, NextResponse } from "next/server";
import { Opportunity } from "@/src/lib/types";

export const runtime = "nodejs";

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] ?? char));

function digestHtml(events: Opportunity[], recipientName: string) {
  const cards = events.slice(0, 8).map((event) => `
    <tr><td style="padding:18px 0;border-bottom:1px solid #e6e9f0">
      <div style="font-size:12px;color:#6b7280;margin-bottom:4px">${esc(event.source)} · ${new Date(event.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
      <a href="${esc(event.url)}" style="font-size:18px;font-weight:700;color:#111827;text-decoration:none">${esc(event.title)}</a>
      <p style="margin:7px 0;color:#4b5563;line-height:1.45">${esc(event.score ? `${event.score.final}/10 — ${event.score.lowScoreExplanation}` : event.description)}</p>
    </td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827"><table width="100%" role="presentation"><tr><td align="center" style="padding:32px 16px"><table width="600" role="presentation" style="max-width:600px;width:100%;background:#fff;border-radius:18px;padding:28px"><tr><td><div style="font-size:13px;font-weight:800;letter-spacing:.14em;color:#4f46e5">MEET / SIGNALS</div><h1 style="margin:10px 0 6px;font-size:28px">Your next good room is here.</h1><p style="color:#4b5563">Hi ${esc(recipientName)}, here are the opportunities ranked for you — with the reasoning visible.</p><table width="100%" role="presentation">${cards}</table><p style="font-size:12px;color:#6b7280;margin-top:24px">Opportunity shouldn’t be a rumor you have to be lucky enough to overhear.</p></td></tr></table></td></tr></table></body></html>`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { email?: string; name?: string; events?: Opportunity[] } | null;
  if (!body?.email || !body.events?.length) return NextResponse.json({ error: "Email and at least one event are required." }, { status: 400 });
  if (!process.env.RESEND_API_KEY || !process.env.DIGEST_FROM_EMAIL) return NextResponse.json({ error: "Digest delivery is not configured. Add RESEND_API_KEY and DIGEST_FROM_EMAIL." }, { status: 503 });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.DIGEST_FROM_EMAIL, to: [body.email], subject: "Your MEET opportunity digest", html: digestHtml(body.events, body.name || "there") }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: result.message || "Resend rejected the digest." }, { status: response.status });
  return NextResponse.json({ id: result.id });
}
