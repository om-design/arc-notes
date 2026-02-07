import { requestUrl } from "obsidian";
import { AIProvider, AIResponse, Message, ToolDefinition, ToolCall } from "./types";

export class AnthropicProvider implements AIProvider {
    name = "Anthropic";
    private apiKey: string;
    private baseUrl = "https://api.anthropic.com/v1";
    private model: string;

    constructor(apiKey: string, model: string = "claude-3-5-sonnet-20241022") {
        this.apiKey = apiKey;
        this.model = model;
    }

    async chat(messages: Message[], tools?: ToolDefinition[]): Promise<AIResponse> {
        // Convert messages to Anthropic format (system message separate)
        const systemMessage = messages.find(m => m.role === "system")?.content || "";

        // Convert and merge consecutive tool results into single user messages
        const conversationMessages: any[] = [];
        let pendingToolResults: any[] = [];

        console.log('[AnthropicProvider] Converting', messages.length, 'messages');

        // First, merge consecutive user messages (Anthropic requires alternating roles)
        const filteredMessages = messages.filter(m => m.role !== "system");
        const mergedMessages: Message[] = [];

        for (let i = 0; i < filteredMessages.length; i++) {
            const current = filteredMessages[i];

            // If this is a user message and the previous was also a user message, merge them
            if (current.role === "user" && mergedMessages.length > 0) {
                const prev = mergedMessages[mergedMessages.length - 1];
                if (prev.role === "user" && typeof prev.content === "string" && typeof current.content === "string") {
                    // Merge the content
                    prev.content = prev.content + "\n\n" + current.content;
                    continue; // Skip adding current message
                }
            }

            mergedMessages.push(current);
        }

        for (const m of mergedMessages) {
            console.log('[AnthropicProvider] Processing message:', {
                role: m.role,
                hasContent: !!m.content,
                hasToolCalls: !!m.tool_calls,
                toolCallId: m.tool_call_id
            });
            if (m.role === "tool") {
                // Collect tool results
                pendingToolResults.push({
                    type: "tool_result" as const,
                    tool_use_id: m.tool_call_id || "",
                    content: m.content || "null"
                });
            } else {
                // Flush pending tool results as a single user message
                if (pendingToolResults.length > 0) {
                    conversationMessages.push({
                        role: "user" as const,
                        content: pendingToolResults
                    });
                    pendingToolResults = [];
                }

                // Add current message
                if (m.role === "assistant" && m.tool_calls) {
                    conversationMessages.push({
                        role: "assistant" as const,
                        content: [
                            ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
                            ...m.tool_calls.map(tc => ({
                                type: "tool_use" as const,
                                id: tc.id,
                                name: tc.function.name,
                                input: JSON.parse(tc.function.arguments)
                            }))
                        ]
                    });
                } else {
                    // Skip messages with empty content
                    if (m.content && m.content.trim() !== "") {
                        conversationMessages.push({
                            role: m.role as "user" | "assistant",
                            content: m.content
                        });
                    }
                }
            }
        }

        // Flush any remaining tool results
        if (pendingToolResults.length > 0) {
            conversationMessages.push({
                role: "user" as const,
                content: pendingToolResults
            });
        }

        // Validate message sequence (Anthropic requires alternating roles)
        for (let i = 1; i < conversationMessages.length; i++) {
            const prev = conversationMessages[i - 1];
            const curr = conversationMessages[i];

            if (prev.role === curr.role) {
                console.error('[AnthropicProvider] Invalid message sequence - consecutive same roles:', {
                    index: i,
                    prevRole: prev.role,
                    currRole: curr.role,
                    prevContent: typeof prev.content === 'string' ? prev.content.substring(0, 100) : 'array',
                    currContent: typeof curr.content === 'string' ? curr.content.substring(0, 100) : 'array'
                });
            }
        }

        // Validate message content (no empty strings for text content)
        for (let i = 0; i < conversationMessages.length; i++) {
            const msg = conversationMessages[i];
            if (typeof msg.content === 'string' && msg.content.trim() === '') {
                console.error('[AnthropicProvider] Empty string content at index', i, 'role:', msg.role);
                // Replace empty strings with a placeholder
                msg.content = '(no response)';
            }
        }

        // Convert tools to Anthropic format
        const anthropicTools = tools?.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters
        }));

        const payload = {
            model: this.model,
            max_tokens: 4096,  // Reasonable limit - truncation is now handled gracefully
            system: systemMessage,
            messages: conversationMessages,
            tools: anthropicTools,
            temperature: 0.2,
        };

        console.log('[AnthropicProvider] Request:', {
            model: this.model,
            messageCount: conversationMessages.length,
            toolCount: anthropicTools?.length || 0,
            hasTools: !!anthropicTools,
            toolNames: anthropicTools?.map(t => t.name),
            lastMessageRole: conversationMessages[conversationMessages.length - 1]?.role
        });

        // Debug: log last message if it contains tool results
        const lastMsg = conversationMessages[conversationMessages.length - 1];
        if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
            const hasToolResult = lastMsg.content.some((c: any) => c.type === "tool_result");
            if (hasToolResult) {
                console.log('[AnthropicProvider] Sending tool results:', lastMsg.content);
            }
        }

        let response;
        const maxRetries = 3;
        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    // Exponential backoff: 2s, 4s, 8s
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`[AnthropicProvider] Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                response = await requestUrl({
                    url: `${this.baseUrl}/messages`,
                    method: "POST",
                    headers: {
                        "x-api-key": this.apiKey,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                });
                break; // Success, exit retry loop
            } catch (error) {
                lastError = error;
                const status = (error as any).status;

                // Only retry on rate limit (429) or server errors (5xx)
                if (status === 429 || (status >= 500 && status < 600)) {
                    console.warn(`[AnthropicProvider] Request failed with status ${status}, attempt ${attempt + 1}/${maxRetries}`);
                    if (attempt === maxRetries - 1) {
                        // Last attempt failed
                        console.error('[AnthropicProvider] All retries exhausted');
                        console.error('[AnthropicProvider] Failed payload:', JSON.stringify(payload, null, 2));
                        if (status === 429) {
                            throw new Error(`Rate limit exceeded. Please wait a moment and try again. (Status: 429)`);
                        }
                        throw new Error(`Anthropic API request failed after ${maxRetries} attempts: ${error.message}`);
                    }
                    continue; // Retry
                } else {
                    // Don't retry on client errors (4xx except 429)
                    console.error('[AnthropicProvider] Request failed:', error);
                    console.error('[AnthropicProvider] Failed payload:', JSON.stringify(payload, null, 2));
                    throw new Error(`Anthropic API request failed: ${error.message}`);
                }
            }
        }

        if (!response) {
            throw new Error(`Anthropic API request failed: ${lastError?.message || 'Unknown error'}`);
        }

        console.log('[AnthropicProvider] Response status:', response.status);

        if (response.status !== 200) {
            console.error('[AnthropicProvider] Error response:', response.text);
            console.error('[AnthropicProvider] Request payload was:', JSON.stringify(payload, null, 2));

            // Provide helpful error messages based on status
            if (response.status === 400) {
                const errorText = response.text || '';
                let hint = '';

                if (errorText.includes('messages: roles must alternate')) {
                    hint = 'Issue: Messages must alternate between user and assistant roles.';
                } else if (errorText.includes('empty')) {
                    hint = 'Issue: One or more messages have empty content.';
                } else if (errorText.includes('tool_use')) {
                    hint = 'Issue: Tool use formatting is incorrect.';
                } else if (errorText.includes('system')) {
                    hint = 'Issue: System message is malformed or too long.';
                }

                console.error('[AnthropicProvider] 400 Error Hint:', hint);
                throw new Error(`Anthropic API error (400 Bad Request): ${hint}\n${errorText}`);
            }

            throw new Error(`Anthropic API error: ${response.status} - ${response.text}`);
        }

        const data = response.json;
        const usage = data.usage || {};
        const outputTokens = usage.output_tokens || 0;
        const inputTokens = usage.input_tokens || 0;

        console.log('[AnthropicProvider] Response:', {
            stopReason: data.stop_reason,
            contentBlocks: data.content?.length || 0,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens
        });

        // Warn if response was truncated
        if (data.stop_reason === "max_tokens") {
            console.warn('[AnthropicProvider] Response truncated due to max_tokens limit!');
        }

        // Warn if approaching limit (last 500 tokens)
        const maxTokens = 4096;
        if (outputTokens > maxTokens - 500) {
            console.warn(`[AnthropicProvider] Approaching token limit: ${outputTokens}/${maxTokens} tokens used`);
        }

        // Extract text content and tool uses
        let textContent = "";
        const toolCalls: ToolCall[] = [];

        for (const block of data.content || []) {
            if (block.type === "text") {
                textContent += block.text;
            } else if (block.type === "tool_use") {
                toolCalls.push({
                    id: block.id,
                    type: "function",
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input)
                    }
                });
            }
        }

        return {
            content: textContent || null,
            model: this.model,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            stop_reason: data.stop_reason,
            usage: usage.input_tokens || usage.output_tokens ? {
                input_tokens: usage.input_tokens || 0,
                output_tokens: usage.output_tokens || 0
            } : undefined,
        };
    }
}
