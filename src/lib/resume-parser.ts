import { PDFParse } from "pdf-parse";
import { getData as getPdfWorkerData } from "pdf-parse/worker";

let workerConfigured = false;

/**
 * `pdfjs-dist` normally resolves its fake worker relative to the compiled
 * server chunk. That path does not exist in Next's dev output. Supplying the
 * package's embedded worker keeps parsing entirely in-process and works in
 * both `next dev` and a deployed Node runtime.
 */
function configurePdfWorker() {
  if (workerConfigured) return;
  PDFParse.setWorker(getPdfWorkerData());
  workerConfigured = true;
}

function pdfError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/password|encrypted/i.test(message)) {
    return new Error("This PDF is password-protected. Upload an unlocked copy or paste your resume text instead.");
  }
  if (/invalid pdf|format|xref|damaged|corrupt/i.test(message)) {
    return new Error("This PDF appears to be damaged or is not a readable PDF. Try exporting it again, then upload the new copy.");
  }
  return new Error("We couldn't read text from this PDF. Try a text-based PDF, or paste your resume details below.");
}

export function decodePdfBase64(fileBase64: string) {
  const data = Buffer.from(fileBase64, "base64");
  if (data.length < 5 || data.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("That file is not a readable PDF. Please choose a PDF resume or upload a text file instead.");
  }
  return data;
}

export async function extractPdfText(fileBase64: string) {
  const data = decodePdfBase64(fileBase64);
  configurePdfWorker();
  const parser = new PDFParse({ data });
  try {
    return (await parser.getText()).text.trim();
  } catch (error) {
    throw pdfError(error);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
