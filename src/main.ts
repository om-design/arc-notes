import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";
import { VaultTools } from "./vaultTools";
import { PerplexityClient, ChatContextPayload } from "./ai/perplexityClient";
import { PerplexityProvider } from "./ai/PerplexityProvider";
import { OllamaProvider } from "./ai/OllamaProvider";
import { OpenAIProvider } from "./ai/OpenAIProvider";
import { AnthropicProvider } from "./ai/AnthropicProvider";
import { ToolExecutor } from "./ai/ToolExecutor";
import { VaultManager, VAULT_TOOLS } from "./vault/VaultManager";
import { ChatContext } from "./ui/chatContext";
import { GeneralResponse, Message, AIProvider } from "./ai/types";
import { ChatView, CHAT_VIEW_TYPE } from "./ui/ChatView";
import { TemplateManager } from "./templates/TemplateManager";
import { TENSEGRITY_CHAT_ICON_COMPACT } from "./ui/tensegrity-icon";

interface ArcNotesSettings {
  mySetting: string;
  brainstormFolder: string;
  aiProvider: "anthropic" | "openai" | "perplexity" | "ollama";
  anthropicApiKey: string;
  anthropicModel: string;
  openaiApiKey: string;
  openaiModel: string;
  perplexityApiKey: string;
  perplexityModel: string;
  ollamaModel: string;
  ollamaBaseUrl: string;
}

const DEFAULT_SETTINGS: ArcNotesSettings = {
  mySetting: "default",
  brainstormFolder: "Brainstorms",
  aiProvider: "anthropic",
  anthropicApiKey: "",
  anthropicModel: "claude-3-5-sonnet-20240620",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  perplexityApiKey: "",
  perplexityModel: "llama-3-sonar-large-32k-online",
  ollamaModel: "llama3",
  ollamaBaseUrl: "http://localhost:11434",
};

export default class ArcNotes extends Plugin {
  settings: ArcNotesSettings;
  vaultTools: VaultTools;
  vaultManager: VaultManager;
  perplexity: PerplexityClient;
  aiProvider: AIProvider;
  toolExecutor: ToolExecutor;
  templateManager: TemplateManager;

  async onload() {
    console.log("loading Arc Notes");
    await this.loadSettings();

    this.vaultTools = new VaultTools(this.app);
    this.vaultManager = new VaultManager(this.app);
    this.perplexity = new PerplexityClient(this.settings.perplexityApiKey, this.settings.perplexityModel);
    this.aiProvider = this.createAIProvider();
    this.toolExecutor = new ToolExecutor(this.vaultManager);
    this.templateManager = new TemplateManager(this.app, this.manifest.dir || '');
    await this.templateManager.loadTemplates();

    // Register chat view
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf) => new ChatView(leaf, this)
    );

    // Ribbon icon opens chat
    this.addRibbonIcon("message-square", "Open Arc Notes Chat", async () => {
      await this.activateChatView();
    });

    this.addStatusBarItem().setText("Arc Notes");

    this.addCommand({
      id: "arc-notes-new-brainstorm-note",
      name: "Create Brainstorm Note",
      checkCallback: (checking: boolean) => {
        const leaf = this.app.workspace.activeLeaf;
        if (leaf) {
          if (!checking) {
            this.createBrainstormNote();
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "arc-notes-open-chat",
      name: "Open Chat",
      callback: async () => {
        await this.activateChatView();
      },
    });

    this.addCommand({
      id: "arc-notes-test-perplexity",
      name: "Test Perplexity Connection",
      callback: async () => {
        await this.testPerplexity();
      },
    });

    this.addCommand({
      id: "arc-notes-create-concept",
      name: "Create Concept Note (Guided Interview)",
      callback: async () => {
        await this.startTemplateInterview("Concept Note");
      },
    });

    this.addSettingTab(new ArcNotesSettingTab(this.app, this));

    // Context menu for selections
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const selection = editor.getSelection();
        const file = this.app.workspace.getActiveFile();
        if (selection && file) {
          menu.addItem((item) => {
            item
              .setTitle("Arc Notes: Ask about selection")
              .setIcon("message-square")
              .onClick(async () => {
                await this.activateChatView({ path: file.path, selection });
              });
          });
        }
      })
    );
  }

  onunload() {
    console.log("unloading Arc Notes");
  }

  createAIProvider(): AIProvider {
    if (this.settings.aiProvider === "anthropic") {
      return new AnthropicProvider(
        this.settings.anthropicApiKey,
        this.settings.anthropicModel
      );
    } else if (this.settings.aiProvider === "openai") {
      return new OpenAIProvider(
        this.settings.openaiApiKey,
        this.settings.openaiModel
      );
    } else if (this.settings.aiProvider === "ollama") {
      return new OllamaProvider(
        this.settings.ollamaModel,
        this.settings.ollamaBaseUrl
      );
    } else {
      return new PerplexityProvider(
        this.settings.perplexityApiKey,
        this.settings.perplexityModel
      );
    }
  }

  async activateChatView(ctx?: ChatContext) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
    }

    if (ctx && leaf.view instanceof ChatView) {
      leaf.view.setContext(ctx);
      // Automatically trigger a message if selection is present
      if (ctx.selection) {
        await leaf.view.handleUserMessage(`Regarding this selection: "${ctx.selection}"\n\n`);
      }
    }

    workspace.revealLeaf(leaf);
  }

  async startTemplateInterview(templateName: string) {
    const template = this.templateManager.getTemplate(templateName);

    if (!template) {
      new Notice(`Template "${templateName}" not found`);
      return;
    }

    // Open chat view
    await this.activateChatView();

    // Get the chat view
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];

    if (leaf && leaf.view instanceof ChatView) {
      // Set interview mode with template
      (leaf.view as any).interviewTemplate = template;

      // Start with the opening message
      const openingMessage = this.templateManager.getInterviewPrompt(template);
      await leaf.view.addSystemMessage(openingMessage);
    }
  }

  async handleAgenticChat(
    userMessage: string,
    ctx: ChatContext,
    view: ChatView
  ): Promise<void> {
    const MAX_ITERATIONS = 10;
    let iterations = 0;

    const messages: Message[] = view.getConversationHistory();

    // Add system message if not present
    const hasSystemMessage = messages.some(m => m.role === "system");
    if (!hasSystemMessage) {
      messages.unshift({
        role: "system",
        content: this.getSystemPrompt(ctx, view)
      });
    }

    // Agentic loop
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      console.log('[Arc Notes] Calling AI with', messages.length, 'messages and', VAULT_TOOLS.length, 'tools');

      // Call AI with tools
      const response = await this.aiProvider.chat(messages, VAULT_TOOLS);

      console.log('[Arc Notes] Response:', {
        hasContent: !!response.content,
        hasToolCalls: !!response.tool_calls,
        toolCallCount: response.tool_calls?.length || 0,
        stopReason: response.stop_reason,
        usage: response.usage
      });

      // Handle truncated responses
      if (response.stop_reason === "max_tokens") {
        await view.addSystemMessage("⚠️ Response was truncated. Reply 'continue' for more.");
      }

      // Add assistant message to local history
      // Only add if there's content OR tool calls (not both null)
      if (response.content || response.tool_calls) {
        // Check if content appears truncated (ends mid-word or mid-sentence)
        let content = response.content || "";
        const appearsTruncated = content && (
          !content.trim().match(/[.!?]$/) &&  // Doesn't end with punctuation
          !response.tool_calls &&             // And no tool calls
          content.length > 50                 // And is substantial
        );

        if (appearsTruncated) {
          console.warn('[Arc Notes] Response appears truncated:', content.slice(-50));
          content = content.trim() + "...";  // Add ellipsis to signal truncation
        }

        const assistantMessage: Message = {
          role: "assistant",
          content: content,
          tool_calls: response.tool_calls
        };
        messages.push(assistantMessage);
      } else {
        console.warn('[Arc Notes] Skipping empty assistant message with no content or tool calls');
      }

      // Display AI response
      if (response.content) {
        await view.addAssistantMessage(response.content);
      }

      // No tool calls? Check if we should continue or we're done
      if (!response.tool_calls || response.tool_calls.length === 0) {
        // If truncated, we might want to continue automatically
        // But for now, let user decide by replying "continue"
        break;
      }

      // Execute tools
      const toolResults = await this.toolExecutor.executeToolCalls(
        response.tool_calls
      );

      // Add tool results to history
      // Note: For Anthropic, all tool results must be in ONE message
      // For OpenAI compatibility, we add them as separate messages but they'll be merged by Anthropic provider
      for (const result of toolResults) {
        view.addToolResultToHistory(
          result.tool_call_id, result.name, result.content
        );
        messages.push({
          role: "tool",
          content: result.content,
          tool_call_id: result.tool_call_id,
          name: result.name
        });
      }

      // Show which tools were used
      await view.addSystemMessage(
        `🔧 Used ${toolResults.length} tool(s): ${toolResults.map(r => r.name).join(", ")}`
      );
    }

    if (iterations >= MAX_ITERATIONS) {
      await view.addSystemMessage("⚠️ Maximum iterations reached.");
    }
  }

  private getSystemPrompt(ctx: ChatContext, view?: ChatView): string {
    // Check if we're in interview mode
    if (view && (view as any).interviewTemplate) {
      const template = (view as any).interviewTemplate;
      return this.templateManager.getInterviewSystemPrompt(template);
    }

    return `You are Arc Notes, an AI assistant integrated into an Obsidian vault.

Current context:
- Active file: ${ctx.path}
${ctx.selection ? `- Selected text: "${ctx.selection}"` : ""}

Available tools:
- search_omnisearch: Search ALL content including PDFs (if Omnisearch is installed)
- create_note: Create a new markdown note
- search_vault: Search for markdown notes by filename (fuzzy matching)
- read_file: Read the complete contents of a note by path
- get_note_outline: Get the structure (headings) of a note
- read_neighbor_notes: Find notes that are linked to/from a note
- patch_note_section: Update a specific section in a note
- list_commands: List all Obsidian commands (including from other plugins)
- execute_command: Execute an Obsidian command by ID

Guidelines:
1. Use search tools to find files - don't assume what exists
2. For file CONTENTS, use read_file
3. For PDF queries, use search_omnisearch (indexes PDF content)
4. To extract PDF sections: search_omnisearch → clean text → create_note
5. If user asks about current file (${ctx.path}), read it first
6. Ask clarifying questions before making changes
7. Use get_note_outline before patch_note_section

Be efficient - use tools only when needed.`;
  }

  async handleChatRequest(prompt: string, ctx: ChatContext): Promise<GeneralResponse> {
    const lower = prompt.toLowerCase();
    let problemType: ChatContextPayload["problemType"] = "free_chat";

    if (ctx.selection && (lower.includes("better") || lower.includes("improve"))) {
      problemType = "improve_selection";
    } else if (lower.includes("verify") || lower.includes("assumption")) {
      problemType = "verify_section";
    } else if (
      lower.includes("consistent") ||
      lower.includes("continuity") ||
      lower.includes("is this true")
    ) {
      problemType = "check_consistency";
    }

    let sectionHeading: string | undefined;
    let sectionText: string | undefined;
    let extraContext = "";

    // Always get the full context of the active file
    const activeNoteText = await this.vaultTools.readNote(ctx.path);
    if (activeNoteText) {
      extraContext = `--- START ACTIVE FILE CONTENT: ${ctx.path} ---\n${activeNoteText}\n--- END ACTIVE FILE CONTENT ---\n\n`;
    }

    if (problemType === "verify_section" || problemType === "improve_selection") {
      const outline = this.vaultTools.getNoteOutline(ctx.path);
      if (outline) {
        extraContext += `Note Outline: ${JSON.stringify(outline.sections)}\n`;
      }
    }

    if (problemType === "check_consistency") {
      const hits = this.vaultTools.searchVault(prompt, 8);
      extraContext += hits
        .map((h) => `[Note: ${h.path}]\n${h.snippet}`)
        .join("\n\n");
    }

    const payload: ChatContextPayload = {
      problemType,
      filePath: ctx.path,
      selection: ctx.selection,
      sectionHeading,
      sectionText,
      extraContext,
    };

    return await this.perplexity.runGeneralTool(prompt, payload);
  }

  async applyGeneralResponse(result: GeneralResponse, ctx: ChatContext, view: ChatView) {
    switch (result.action) {
      case "answer_only":
        if (result.answer) await view.addAssistantMessage(result.answer);
        break;

      case "rewrite_selection":
        if (!ctx.selection || !result.rewrite) {
          if (result.answer) await view.addAssistantMessage(result.answer);
          return;
        }
        // Apply rewrite via editor or vault tools
        // For simplicity, we'll patch the section or inform the user
        await view.addAssistantMessage("Suggested rewrite generated. [Apply Button Placeholder]");
        if (result.answer) await view.addAssistantMessage(result.answer);
        break;

      case "section_review":
        await view.addAssistantMessage("Section review completed.");
        if (result.sectionReview) {
          let reviewText = result.sectionReview.map(r => `- **${r.label}**: ${r.status}\n  ${r.justification}`).join("\n");
          await view.addAssistantMessage(reviewText);
        }
        break;

      case "consistency_report":
        await view.addAssistantMessage("Consistency check completed.");
        if (result.consistencyIssues) {
          let issuesText = result.consistencyIssues.map(i => `- ${i.description}`).join("\n");
          await view.addAssistantMessage(issuesText);
        }
        break;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Re-init providers
    if (this.perplexity) {
      this.perplexity = new PerplexityClient(this.settings.perplexityApiKey, this.settings.perplexityModel);
    }
    this.aiProvider = this.createAIProvider();
  }

  async createBrainstormNote() {
    const vault = this.app.vault;
    const workspace = this.app.workspace;

    const conceptName = await promptForInput(
      this.app,
      "New Brainstorm Note",
      "Concept name"
    );

    if (!conceptName) {
      new Notice("Brainstorm note creation cancelled");
      return;
    }

    const fileName = `${conceptName}.md`;
    const folderPath = this.settings.brainstormFolder?.trim() || "";
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
    const today = new Date().toISOString().slice(0, 10);

    const content = `---
concept: ${conceptName}
status: draft
tags: []
related_concepts: []
created: ${today}
---

## Core Idea

## Key Points

## Design Implications

## Implementation Notes

## Examples
`;

    if (folderPath) {
      try {
        await vault.createFolder(folderPath).catch(() => { });
      } catch (e) {
        console.error(`Failed to ensure folder exists: ${folderPath}`, e);
      }
    }

    let file: TFile;
    try {
      file = await vault.create(filePath, content);
    } catch (e) {
      new Notice(`Failed to create note: ${filePath}`);
      console.error(e);
      return;
    }

    const leaf = workspace.getLeaf(true);
    await leaf.openFile(file);
    new Notice(`Created Brainstorm note: ${filePath}`);
  }

  async testPerplexity() {
    if (!this.settings.perplexityApiKey) {
      new Notice("Please set your Perplexity API key in settings first");
      return;
    }

    new Notice("Testing Perplexity connection...");

    try {
      const client = new PerplexityClient(this.settings.perplexityApiKey, this.settings.perplexityModel);
      const payload: ChatContextPayload = {
        problemType: "free_chat",
        filePath: "test.md"
      };
      const response = await client.runGeneralTool("Say 'Hello!'", payload);
      new Notice(`✓ Perplexity connected! Action: ${response.action}`);
    } catch (error) {
      new Notice(`✗ Perplexity error: ${error.message}`);
      console.error("Perplexity test failed:", error);
    }
  }
}

class InputPromptModal extends Modal {
  promptText: string;
  inputValue: string = "";
  onSubmit: (value: string | null) => void;

  constructor(app: App, promptText: string, onSubmit: (value: string | null) => void) {
    super(app);
    this.promptText = promptText;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.promptText });
    const input = contentEl.createEl("input", { type: "text" });
    input.focus();
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.close();
        this.onSubmit(input.value.trim() || null);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        this.onSubmit(null);
      }
    });
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const okButton = buttonContainer.createEl("button", { text: "Create" });
    okButton.addEventListener("click", () => {
      this.close();
      this.onSubmit(input.value.trim() || null);
    });
    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.close();
      this.onSubmit(null);
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

function promptForInput(app: App, title: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new InputPromptModal(app, title, (value) => {
      resolve(value);
    });
    modal.open();
  });
}

class ArcNotesSettingTab extends PluginSettingTab {
  plugin: ArcNotes;
  constructor(app: App, plugin: ArcNotes) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Arc Notes Settings" });

    containerEl.createEl("h3", { text: "AI Provider" });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Choose which AI provider to use")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("anthropic", "Anthropic Claude")
          .addOption("openai", "OpenAI")
          .addOption("ollama", "Ollama (Local)")
          .addOption("perplexity", "Perplexity")
          .setValue(this.plugin.settings.aiProvider)
          .onChange(async (value: "anthropic" | "openai" | "perplexity" | "ollama") => {
            this.plugin.settings.aiProvider = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh to show/hide relevant settings
          })
      );

    // Anthropic Settings
    if (this.plugin.settings.aiProvider === "anthropic") {
      containerEl.createEl("h4", { text: "Anthropic Claude Configuration" });
      containerEl.createEl("p", { text: "Recommended for balanced cost and high capability with tool use.", cls: "setting-item-description"});
      new Setting(containerEl)
        .setName("Anthropic API Key")
        .setDesc("Your Anthropic API key")
        .addText((text) =>
          text
            .setPlaceholder("sk-ant-api03-...")
            .setValue(this.plugin.settings.anthropicApiKey || "")
            .onChange(async (value) => {
              this.plugin.settings.anthropicApiKey = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Claude Model")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("claude-3-5-sonnet-20240620", "Claude 3.5 Sonnet (Recommended)")
            .addOption("claude-3-haiku-20240307", "Claude 3 Haiku (Fast & Cheap)")
            .addOption("claude-3-opus-20240229", "Claude 3 Opus (Most Capable)")
            .setValue(this.plugin.settings.anthropicModel)
            .onChange(async (value) => {
              this.plugin.settings.anthropicModel = value;
              await this.plugin.saveSettings();
            })
        );
    }

    // OpenAI Settings
    if (this.plugin.settings.aiProvider === "openai") {
      containerEl.createEl("h4", { text: "OpenAI Configuration" });
      new Setting(containerEl)
        .setName("OpenAI API Key")
        .setDesc("Your OpenAI API key")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openaiApiKey || "")
            .onChange(async (value) => {
              this.plugin.settings.openaiApiKey = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("OpenAI Model")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("gpt-4o-mini", "GPT-4o Mini (Fast & Cheap)")
            .addOption("gpt-4o", "GPT-4o (Most Capable)")
            .addOption("gpt-4-turbo", "GPT-4 Turbo")
            .setValue(this.plugin.settings.openaiModel)
            .onChange(async (value) => {
              this.plugin.settings.openaiModel = value;
              await this.plugin.saveSettings();
            })
        );
    }

    // Ollama Settings
    if (this.plugin.settings.aiProvider === "ollama") {
      containerEl.createEl("h4", { text: "Ollama Configuration" });
       containerEl.createEl("p", {
        text: "Run LLMs locally for free. Requires installing Ollama and downloading a model. Supports tool calling.",
        cls: "setting-item-description"
      });

      new Setting(containerEl)
        .setName("Ollama Model")
        .setDesc("The name of the model you have downloaded in Ollama (e.g., 'llama3', 'phi3:medium').")
        .addText((text) =>
          text
            .setPlaceholder("llama3")
            .setValue(this.plugin.settings.ollamaModel || "")
            .onChange(async (value) => {
              this.plugin.settings.ollamaModel = value.trim();
              await this.plugin.saveSettings();
            })
        );
      
      new Setting(containerEl)
        .setName("Ollama Base URL")
        .setDesc("The URL of your Ollama server.")
        .addText((text) =>
          text
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ollamaBaseUrl || "")
            .onChange(async (value) => {
              this.plugin.settings.ollamaBaseUrl = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    // Perplexity Settings
    if (this.plugin.settings.aiProvider === "perplexity") {
      containerEl.createEl("h4", { text: "Perplexity Configuration" });
      containerEl.createEl("p", {
        text: "⚠️ Note: Perplexity models do not support tool calling. Chat will work but cannot access vault files.",
        cls: "setting-item-description"
      });

      new Setting(containerEl)
        .setName("Perplexity API Key")
        .setDesc("Your Perplexity API key")
        .addText((text) =>
          text
            .setPlaceholder("pplx-...")
            .setValue(this.plugin.settings.perplexityApiKey || "")
            .onChange(async (value) => {
              this.plugin.settings.perplexityApiKey = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Perplexity Model")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("llama-3-sonar-large-32k-online", "Sonar Online (Recommended)")
            .addOption("llama-3-sonar-large-32k-chat", "Sonar Chat")
            .setValue(this.plugin.settings.perplexityModel)
            .onChange(async (value) => {
              this.plugin.settings.perplexityModel = value;
              await this.plugin.saveSettings();
            })
        );
    }
    containerEl.createEl("h3", { text: "Templates" });
    new Setting(containerEl)
      .setName("Brainstorm folder")
      .setDesc("Folder where Brainstorm notes will be created (e.g. Concepts/Brainstorms). Leave empty for vault root.")
      .addText((text) =>
        text
          .setPlaceholder("Brainstorms")
          .setValue(this.plugin.settings.brainstormFolder || "")
          .onChange(async (value) => {
            this.plugin.settings.brainstormFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
