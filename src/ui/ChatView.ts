import { ItemView, WorkspaceLeaf, MarkdownRenderer } from "obsidian";
import type ArcNotes from "../main";
import { ChatContext } from "./chatContext";
import { Message } from "../ai/types";

export const CHAT_VIEW_TYPE = "arc-notes-chat-view";

export class ChatView extends ItemView {
    plugin: ArcNotes;
    private chatContainer: HTMLElement;
    private inputContainer: HTMLElement;
    private messagesContainer: HTMLElement;
    private currentContext: ChatContext | null = null;
    private conversationHistory: Message[] = [];
    private isProcessing: boolean = false;

    constructor(leaf: WorkspaceLeaf, plugin: ArcNotes) {
        super(leaf);
        this.plugin = plugin;
    }

    setContext(ctx: ChatContext) {
        this.currentContext = ctx;
        this.addSystemMessage(`Context loaded: [${ctx.path}] ${ctx.selection ? "(Selection detected)" : ""}`);
    }

    getViewType(): string {
        return CHAT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Arc Notes Chat";
    }

    getIcon(): string {
        return "message-square";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("arc-notes-chat-view");

        this.chatContainer = container.createDiv({ cls: "arc-notes-chat-container" });
        this.messagesContainer = this.chatContainer.createDiv({
            cls: "arc-notes-messages",
        });

        this.inputContainer = this.chatContainer.createDiv({
            cls: "arc-notes-input-container",
        });

        const inputWrapper = this.inputContainer.createDiv({
            cls: "arc-notes-input-wrapper",
        });

        const textarea = inputWrapper.createEl("textarea", {
            cls: "arc-notes-input",
            attr: {
                placeholder: "Ask Arc Notes...",
                rows: "1",
            },
        });

        const sendButton = inputWrapper.createEl("button", {
            cls: "arc-notes-send-button",
            text: "↑",
        });

        textarea.addEventListener("input", () => {
            textarea.style.height = "auto";
            textarea.style.height = textarea.scrollHeight + "px";
        });

        const sendMessage = async () => {
            const message = textarea.value.trim();
            if (!message) return;

            textarea.value = "";
            textarea.style.height = "auto";
            await this.handleUserMessage(message);
        };

        sendButton.addEventListener("click", sendMessage);
        textarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        await this.addSystemMessage("Arc Notes initialized. Ready for orchestration.");
    }

    async onClose() { }

    async addUserMessage(content: string) {
        this.conversationHistory.push({ role: "user", content });
        const messageEl = this.messagesContainer.createDiv({
            cls: "arc-notes-message arc-notes-user-message",
        });
        const contentEl = messageEl.createDiv({ cls: "arc-notes-message-content" });
        await MarkdownRenderer.render(this.app, content, contentEl, "", this);
        this.scrollToBottom();
    }

    async addAssistantMessage(content: string) {
        this.conversationHistory.push({
            role: "assistant",
            content,
            tool_calls: undefined
        });
        const messageEl = this.messagesContainer.createDiv({
            cls: "arc-notes-message arc-notes-assistant-message",
        });
        const contentEl = messageEl.createDiv({ cls: "arc-notes-message-content" });
        await MarkdownRenderer.render(this.app, content, contentEl, "", this);
        this.scrollToBottom();
        return contentEl;
    }

    async addSystemMessage(content: string) {
        const messageEl = this.messagesContainer.createDiv({
            cls: "arc-notes-message arc-notes-system-message",
        });
        const contentEl = messageEl.createDiv({ cls: "arc-notes-message-content" });
        await MarkdownRenderer.render(this.app, content, contentEl, "", this);
        this.scrollToBottom();
    }

    private scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    clearHistory() {
        this.conversationHistory = [];
        this.messagesContainer.empty();
    }

    addToolResultToHistory(toolCallId: string, toolName: string, result: string) {
        // Not displayed in UI - just for AI context
        this.conversationHistory.push({
            role: "tool",
            content: result,
            tool_call_id: toolCallId,
            name: toolName
        });
    }

    getConversationHistory(): Message[] {
        return [...this.conversationHistory];
    }

    public async handleUserMessage(content: string) {
        // Prevent multiple simultaneous requests
        if (this.isProcessing) {
            await this.addSystemMessage("⏳ Please wait for the current response to complete...");
            return;
        }

        this.isProcessing = true;

        try {
            await this.addUserMessage(content);

            // Always re-evaluate the active file context
            const activeFile = this.app.workspace.getActiveFile();

            if (activeFile) {
                // If the file changed, we should probably clear any old selection
                if (this.currentContext && this.currentContext.path !== activeFile.path) {
                    this.currentContext = { path: activeFile.path };
                } else if (!this.currentContext) {
                    this.currentContext = { path: activeFile.path };
                }
            }

            if (!this.currentContext) {
                await this.addSystemMessage("❌ No active file detected. Please open a note first.");
                return;
            }

            // Use new agentic loop
            await this.plugin.handleAgenticChat(content, this.currentContext, this);
        } catch (error) {
            await this.addSystemMessage(`❌ Error: ${error.message}`);
        } finally {
            this.isProcessing = false;
        }
    }
}
