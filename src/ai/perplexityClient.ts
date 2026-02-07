import { GENERAL_RESPONSE_SCHEMA, GeneralResponse } from "./types";

export interface ChatContextPayload {
    problemType: "free_chat" | "improve_selection" | "verify_section" | "check_consistency";
    filePath: string;
    selection?: string;
    sectionHeading?: string;
    sectionText?: string;
    extraContext?: string; // snippets, outlines, etc.
}

export class PerplexityClient {
    constructor(private apiKey: string, private model: string = "sonar-pro") { }

    async runGeneralTool(
        userPrompt: string,
        ctx: ChatContextPayload
    ): Promise<GeneralResponse> {
        const body = {
            model: this.model,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "arc_notes_general_response",
                    schema: GENERAL_RESPONSE_SCHEMA,
                },
            },
            messages: [
                {
                    role: "system",
                    content:
                        "You are Arc Notes, an assistant working over an Obsidian vault. " +
                        "You must decide whether to answer, rewrite the current selection, " +
                        "review a section, or report consistency issues. " +
                        "Always respond with JSON matching the given schema and nothing else.",
                },
                {
                    role: "user",
                    content:
                        `User prompt: ${userPrompt}\n\n` +
                        `Problem type: ${ctx.problemType}\n` +
                        `File path: ${ctx.filePath}\n\n` +
                        (ctx.selection
                            ? `Current selection:\n---\n${ctx.selection}\n---\n\n`
                            : "") +
                        (ctx.sectionHeading && ctx.sectionText
                            ? `Section (${ctx.sectionHeading}):\n---\n${ctx.sectionText}\n---\n\n`
                            : "") +
                        (ctx.extraContext
                            ? `Additional context from vault:\n${ctx.extraContext}\n`
                            : ""),
                },
            ],
        };

        const res = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Perplexity error: ${res.status} ${res.statusText} - ${errorText}`);
        }

        const json = await res.json();
        const content = json.choices[0].message.content;

        try {
            return JSON.parse(content) as GeneralResponse;
        } catch (e) {
            console.error("Failed to parse Perplexity JSON response:", content);
            throw new Error("AI returned malformed JSON. Please try again.");
        }
    }
}
