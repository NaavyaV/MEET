import { NextRequest, NextResponse } from "next/server";
import { groqConfigured, groqModel, parseProfileWithGroq } from "@/src/lib/groq";
import { extractPdfText } from "@/src/lib/resume-parser";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { text?: unknown; fileBase64?: unknown; fileType?: unknown } | null;
    if (!body) return NextResponse.json({ error: "The upload request was incomplete. Please try again." }, { status: 400 });
    let text = typeof body.text === "string" ? body.text.trim() : "";
    if (typeof body.fileBase64 === "string" && body.fileBase64) {
      if (body.fileBase64.length > 10_700_000) return NextResponse.json({ error: "Please upload a PDF smaller than 8 MB." }, { status: 413 });
      text = await extractPdfText(body.fileBase64);
    }
    if (!text) return NextResponse.json({ error: "No readable text was found in that file. Try a text-based PDF or enter your profile details below." }, { status: 400 });
    const profile = await parseProfileWithGroq(text);
    if (!profile) return NextResponse.json({ error: "No profile details could be identified in that document. Please add your details manually." }, { status: 422 });
    return NextResponse.json({ profile, model: groqConfigured() ? groqModel : "MEET local resume extractor" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "We couldn't read that file. Please try another PDF or enter your details manually." }, { status: 422 });
  }
}
