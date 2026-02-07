import { VaultManager } from "../vault/VaultManager";
import { ToolCall, ToolResult } from "./types";

export class ToolExecutor {
    constructor(private vaultManager: VaultManager) {}

    async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
        const results: ToolResult[] = [];

        for (const toolCall of toolCalls) {
            try {
                const result = await this.executeSingleTool(toolCall);
                results.push({
                    tool_call_id: toolCall.id,
                    name: toolCall.function.name,
                    content: JSON.stringify(result)
                });
            } catch (error) {
                results.push({
                    tool_call_id: toolCall.id,
                    name: toolCall.function.name,
                    content: JSON.stringify({
                        error: error.message,
                        success: false
                    })
                });
            }
        }
        return results;
    }

    private async executeSingleTool(toolCall: ToolCall): Promise<any> {
        const { name, arguments: argsStr } = toolCall.function;
        const args = JSON.parse(argsStr);

        switch (name) {
            case "search_omnisearch":
                const omnisearchAvailable = this.vaultManager.isOmnisearchAvailable();
                if (!omnisearchAvailable) {
                    return {
                        error: "Omnisearch plugin is not installed or not enabled. Please install Omnisearch to search PDFs and other content.",
                        fallback: "Use search_vault for basic markdown file search."
                    };
                }
                const omnisearchResults = await this.vaultManager.searchWithOmnisearch(args.query);
                return {
                    results: omnisearchResults,
                    count: omnisearchResults.length,
                    query: args.query
                };
            case "create_note":
                const created = await this.vaultManager.createNote(args.path, args.content);
                return {
                    success: created,
                    path: args.path,
                    message: created ? `Note created: ${args.path}` : `Failed to create note (may already exist): ${args.path}`
                };
            case "list_commands":
                const allCommands = this.vaultManager.listAvailableCommands();
                if (args.filter) {
                    const filterLower = args.filter.toLowerCase();
                    return allCommands.filter(cmd =>
                        cmd.id.toLowerCase().includes(filterLower) ||
                        cmd.name.toLowerCase().includes(filterLower)
                    );
                }
                return allCommands;
            case "execute_command":
                const executed = await this.vaultManager.executeCommand(args.command_id);
                return {
                    success: executed,
                    command_id: args.command_id,
                    message: executed ? "Command executed successfully" : "Command execution failed"
                };
            case "search_vault":
                return await this.vaultManager.searchVault(args.query);
            case "read_file":
                return await this.vaultManager.readFile(args.path);
            case "get_note_outline":
                return await this.vaultManager.getNoteOutline(args.path);
            case "read_neighbor_notes":
                return await this.vaultManager.readNeighborNotes(args.path);
            case "patch_note_section":
                const success = await this.vaultManager.patchSection(
                    args.path, args.section, args.content
                );
                return { success, path: args.path, section: args.section };
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
}
