import { App, Notice, TFile, requestUrl } from "obsidian";

const OUTPUT_FOLDER = "02_Theoretical_Proofs";
const MAX_TEXT_LENGTH = 6000;

function buildIntakePrompt(filename: string, text: string): string {
    return `You are creating a structured research note for the Has-Needs project — a distributed sovereign data platform for disaster resilience and peer coordination.

Source document: ${filename}

Extracted text:
${text}

Create a structured markdown note with these sections:

## Summary
2-3 sentence overview of the document's main argument or contribution.

## Key Findings
- Bullet list of the most important findings, data points, or claims (4-8 bullets)

## Relevant to Has-Needs
- Quote or closely paraphrase what this document explicitly says about community needs, coordination, resilience, trust, or prosocial behavior. Do NOT speculate or suggest design changes. Only report what the document actually says.

## Citation
Full citation for this document (author, title, year if found in text).

Output only the markdown note content. No preamble.`;
}

async function extractPdfText(app: App, file: TFile): Promise<string> {
    const pdfjsLib = (window as any)["pdfjs-dist/build/pdf"] || (window as any).pdfjsLib;
    if (!pdfjsLib) {
        throw new Error("PDF.js not available — try opening the PDF in Obsidian's PDF viewer first");
    }

    const arrayBuffer = await app.vault.readBinary(file);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(" ") + "\n";
    }

    return text.slice(0, MAX_TEXT_LENGTH);
}

async function callOllama(
    baseUrl: string,
    model: string,
    prompt: string
): Promise<string> {
    const url = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const response = await requestUrl({
        url: `${url}/api/generate`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            prompt,
            stream: false,
        }),
    });
    return response.json.response as string;
}

export async function intakePdf(
    app: App,
    file: TFile,
    ollamaBaseUrl: string,
    ollamaModel: string
): Promise<void> {
    try {
        new Notice("Extracting PDF text…");
        const text = await extractPdfText(app, file);

        new Notice("Running Ollama analysis…");
        const prompt = buildIntakePrompt(file.name, text);
        const analysis = await callOllama(ollamaBaseUrl, ollamaModel, prompt);

        new Notice("Creating note…");

        const stem = file.basename;
        const outputPath = `${OUTPUT_FOLDER}/${stem}.md`;

        const existing = app.vault.getAbstractFileByPath(outputPath);
        if (existing) {
            new Notice(`File already exists: ${outputPath} — aborting`);
            return;
        }

        // Ensure output folder exists
        if (!app.vault.getAbstractFileByPath(OUTPUT_FOLDER)) {
            await app.vault.createFolder(OUTPUT_FOLDER);
        }

        const today = new Date().toISOString().slice(0, 10);
        const content = `---
source_pdf: "${file.path}"
intake_date: "${today}"
tags: [theoretical-proof, arc-notes-intake]
---

${analysis}
`;

        const newFile = await app.vault.create(outputPath, content);
        await app.workspace.openLinkText(outputPath, "", true);

        new Notice(`Done → ${outputPath}`);
    } catch (err: any) {
        console.error("[Arc Notes] PDF intake failed:", err);
        new Notice(`PDF intake error: ${err.message}`);
    }
}
