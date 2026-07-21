import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { parseProfileWithGroq } from "@/src/lib/groq";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { text?: string; fileBase64?: string; fileType?: string } | null;
  let text = body?.text?.trim() ?? "";
  if (body?.fileBase64 && (body.fileType === "application/pdf" || !body.fileType)) {
    if (body.fileBase64.length > 10_700_000) return NextResponse.json({ error: "Please upload a PDF smaller than 8 MB." }, { status: 413 });
    const parser = new PDFParse({ data: Buffer.from(body.fileBase64, "base64") });
    try { text = (await parser.getText()).text.trim(); } finally { await parser.destroy(); }
  }
  if (!text) return NextResponse.json({ error: "No readable text was found in that file. Try a text-based PDF or enter your profile details below." }, { status: 400 });
  const profile = await parseProfileWithGroq(text);
  if (!profile) return NextResponse.json({ error: "GROQ_API_KEY is not configured or the document could not be parsed." }, { status: 503 });
  return NextResponse.json({ profile, model: process.env.GROQ_MODEL || "llama-3.1-8b-instant" });
}
