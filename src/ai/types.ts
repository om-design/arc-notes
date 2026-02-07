export type ActionType =
    | "answer_only"
    | "rewrite_selection"
    | "section_review"
    | "consistency_report";

export interface GeneralResponse {
    action: ActionType;
    answer?: string;

    rewrite?: {
        replacementMarkdown: string;
    };

    sectionReview?: {
        label: string;
        status: string;
        justification: string;
        suggestedRevision?: string;
    }[];

    consistencyIssues?: {
        description: string;
        suggestedFix?: string;
    }[];
}

export const GENERAL_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        action: {
            type: "string",
            enum: [
                "answer_only",
                "rewrite_selection",
                "section_review",
                "consistency_report",
            ],
        },
        answer: { type: "string" },
        rewrite: {
            type: "object",
            properties: {
                replacementMarkdown: { type: "string" },
            },
            required: ["replacementMarkdown"],
        },
        sectionReview: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    label: { type: "string" },
                    status: { type: "string" },
                    justification: { type: "string" },
                    suggestedRevision: { type: "string" },
                },
                required: ["label", "status", "justification"],
            },
        },
        consistencyIssues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    description: { type: "string" },
                    suggestedFix: { type: "string" },
                },
                required: ["description"],
            },
        },
    },
    required: ["action"],
} as const;

// Tool Calling Types for Agentic Architecture

export interface Message {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}

export interface ToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, any>;
            required: string[];
        };
    };
}

export interface ToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

export interface AIResponse {
    content: string | null;
    model: string;
    tool_calls?: ToolCall[];
    stop_reason?: string;  // e.g., "end_turn", "max_tokens", "stop_sequence"
    usage?: {
        input_tokens: number;
        output_tokens: number;
    };
}

export interface AIProvider {
    name: string;
    chat(messages: Message[], tools?: ToolDefinition[]): Promise<AIResponse>;
}

export interface ToolResult {
    tool_call_id: string;
    name: string;
    content: string; // JSON stringified result
}
