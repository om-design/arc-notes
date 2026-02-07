import { requestUrl } from "obsidian";
import { AIProvider, AIResponse, Message, ToolDefinition } from "./types";

export class OpenAIProvider implements AIProvider {
    name = "OpenAI";
    private apiKey: string;
    private baseUrl = "https://api.openai.com/v1";
    private model: string;

    constructor(apiKey: string, model: string = "gpt-4o-mini") {
        this.apiKey = apiKey;
        this.model = model;
    }

    async chat(messages: Message[], tools?: ToolDefinition[]): Promise<AIResponse> {
        const payload = {
            model: this.model,
            messages: messages,
            tools: tools,
            tool_choice: tools && tools.length > 0 ? "auto" : undefined,
            temperature: 0.2,
        };

        console.log('[OpenAIProvider] Request:', {
            model: this.model,
            messageCount: messages.length,
            toolCount: tools?.length || 0,
            hasTools: !!tools,
            toolNames: tools?.map(t => t.function.name)
        });

        let response;
        try {
            response = await requestUrl({
                url: `${this.baseUrl}/chat/completions`,
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
        } catch (error) {
            console.error('[OpenAIProvider] Request failed:', error);
            throw new Error(`OpenAI API request failed: ${error.message}`);
        }

        console.log('[OpenAIProvider] Response status:', response.status);

        if (response.status !== 200) {
            console.error('[OpenAIProvider] Error response:', response.text);
            throw new Error(`OpenAI API error: ${response.status} ${response.text}`);
        }

        const data = response.json;
        console.log('[OpenAIProvider] Response:', {
            hasChoices: !!data.choices,
            toolCallCount: data.choices[0]?.message?.tool_calls?.length || 0
        });

        const choice = data.choices[0];
        return {
            content: choice.message.content,
            model: this.model,
            tool_calls: choice.message.tool_calls,
        };
    }
}
