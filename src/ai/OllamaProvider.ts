import { requestUrl } from "obsidian";
import { AIProvider, AIResponse, Message, ToolDefinition } from "./types";

export class OllamaProvider implements AIProvider {
    name = "Ollama";
    private baseUrl: string;
    private model: string;

    constructor(model: string, baseUrl: string = "http://localhost:11434") {
        this.model = model;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    async chat(messages: Message[], tools?: ToolDefinition[]): Promise<AIResponse> {
        const payload: any = {
            model: this.model,
            messages: messages,
            stream: false, // Ensure we get the full response at once
        };

        if (tools && tools.length > 0) {
            payload.tools = tools;
            // Force JSON output when tools are present to get structured tool_calls
            payload.format = "json";
        }

        console.log('[OllamaProvider] Request:', {
            model: this.model,
            messageCount: messages.length,
            toolCount: tools?.length || 0,
        });

        let response;
        try {
            response = await requestUrl({
                url: `${this.baseUrl}/api/chat`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
        } catch (error) {
            console.error('[OllamaProvider] Request failed:', error);
            // Handle common case where Ollama server isn't running
            if (error.message.includes('Failed to fetch')) {
                throw new Error(`Ollama request failed. Is the Ollama server running at ${this.baseUrl}?`);
            }
            throw new Error(`Ollama API request failed: ${error.message}`);
        }

        console.log('[OllamaProvider] Response status:', response.status);

        if (response.status !== 200) {
            console.error('[OllamaProvider] Error response:', response.text);
            throw new Error(`Ollama API error: ${response.status} ${response.text}`);
        }

        const data = response.json;

        // When format: "json" is used, the response content is a JSON string.
        // We need to parse it to get the actual message object.
        const message = (payload.format === 'json' && typeof data.message.content === 'string')
            ? JSON.parse(data.message.content)
            : data.message;
        
        console.log('[OllamaProvider] Response:', {
            hasMessage: !!message,
            toolCallCount: message?.tool_calls?.length || 0
        });

        return {
            content: message.content,
            model: this.model,
            tool_calls: message.tool_calls,
            usage: {
                input_tokens: data.prompt_eval_count,
                output_tokens: data.eval_count,
            },
            stop_reason: data.done_reason,
        };
    }
}
