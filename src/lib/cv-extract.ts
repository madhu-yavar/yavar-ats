/**
 * Browser-side resume text extraction for bulk CV upload.
 * PDF via pdf.js, DOCX via mammoth, everything else read as plain text.
 * All imports are dynamic so nothing touches the SSR bundle.
 */
export async function extractResumeText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    // Vite bundles the pdf.js worker for us; a worker *port* is the only
    // reliable wiring in both dev and the built worker runtime.
    const PdfWorker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?worker")).default;
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker() as unknown as Worker;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" ")
          .replace(/\s+/g, " "),
      );
    }
    const text = pages.join("\n\n").trim();
    if (text.length < 20) {
      throw new Error(
        "This PDF has no selectable text (it looks like a scan or image). Export a text PDF or upload the DOCX.",
      );
    }
    return text;
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    const text = value.trim();
    if (text.length < 20) throw new Error("No readable text found in this Word file");
    return text;
  }

  if (name.endsWith(".doc")) {
    throw new Error("Legacy .doc is not readable — save as .docx or PDF");
  }

  const plain = (await file.text()).trim();
  if (plain.length < 20) throw new Error("File is empty or unreadable");
  return plain;
}


/** Proportionally rescale weights so they total exactly 100. */
export function balanceWeights<T extends Record<string, number>>(w: T): T {
  const keys = Object.keys(w) as (keyof T)[];
  const total = keys.reduce((s, k) => s + (w[k] as number), 0);
  if (total === 0) return w;
  const scaled = keys.map((k) => Math.round(((w[k] as number) * 100) / total));
  const drift = 100 - scaled.reduce((s, n) => s + n, 0);
  const out = { ...w };
  keys.forEach((k, i) => {
    (out[k] as number) = scaled[i]!;
  });
  // Push any rounding drift onto the largest bucket.
  let biggest = keys[0]!;
  keys.forEach((k) => {
    if ((out[k] as number) > (out[biggest] as number)) biggest = k;
  });
  (out[biggest] as number) = (out[biggest] as number) + drift;
  return out;
}
