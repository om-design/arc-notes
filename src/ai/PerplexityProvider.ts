import { requestUrl } from "obsidian";
import { AIProvider, AIResponse, Message, ToolDefinition, ToolCall } from "./types";

export class PerplexityProvider implements AIProvider {
    name = "Perplexity";
    private apiKey: string;
    private baseUrl = "https://api.perplexity.ai";
    private model: string;

    constructor(apiKey: string, model: string = "llama-3.1-sonar-large-128k-online") {
        this.apiKey = apiKey;
        this.model = model;
    }

    async chat(messages: Message[], tools?: ToolDefinition[]): Promise<AIResponse> {
        const payload = {
            model: this.model,
            messages: messages,
            tools: tools,
            tool_choice: tools ? "auto" : undefined,
            temperature: 0.2,
        };

        console.log('[PerplexityProvider] Request:', {
            model: this.model,
            messageCount: messages.length,
            toolCount: tools?.length || 0,
            hasTools: !!tools,
            toolNames: tools?.map(t => t.function.name)
        });
        console.log('[PerplexityProvider] Full payload:', JSON.stringify(payload, null, 2));

        const response = await requestUrl({
            url: `${this.baseUrl}/chat/completions`,
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (response.status !== 200) {
            throw new Error(`Perplexity API error: ${response.status} ${response.text}`);
        }

        const data = response.json;
        console.log('[PerplexityProvider] Response data:', JSON.stringify(data, null, 2));
        const choice = data.choices[0];
        return {
            content: choice.message.content,
            model: this.model,
            tool_calls: choice.message.tool_calls,
        };
    }

    async *streamChat(messages: Message[], tools?: ToolDefinition[]): AsyncGenerator<string | ToolCall[]> {
        // Note: Obsidian's requestUrl doesn't support streaming
        throw new Error("Streaming not supported with Obsidian's requestUrl");
    }
}
