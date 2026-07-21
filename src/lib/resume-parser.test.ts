import { describe, expect, it } from "vitest";
import { extractResumeIdentity } from "./groq";
import { decodePdfBase64, extractPdfText } from "./resume-parser";

function minimalPdf(text: string) {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const startXref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;
  return Buffer.from(pdf);
}

describe("resume parsing", () => {
  it("uses the embedded PDF worker instead of a Next server chunk", async () => {
    const input = minimalPdf("Avery Johnson avery.johnson@example.com").toString("base64");
    await expect(extractPdfText(input)).resolves.toContain("Avery Johnson");
  });

  it("rejects a base64 upload that is not actually a PDF", () => {
    expect(() => decodePdfBase64(Buffer.from("not a PDF").toString("base64"))).toThrow("not a readable PDF");
  });

  it("identifies the visible name and email before model enrichment", () => {
    expect(extractResumeIdentity("Avery Johnson avery.johnson@example.com\nSoftware Engineer")).toEqual({
      name: "Avery Johnson",
      email: "avery.johnson@example.com",
    });
  });
});
