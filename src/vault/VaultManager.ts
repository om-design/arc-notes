import { App, TFile, prepareFuzzySearch } from "obsidian";
import { ToolDefinition } from "../ai/types";

export type NotePath = string;

export interface SearchResult {
    path: NotePath;
    score: number;
}

export interface SectionId {
    heading: string;      // exact H2/H3 text
    index: number;        // nth occurrence under that heading
}

export interface NoteOutline {
    title: string;
    sections: SectionId[];
    frontmatter: any;
}

export class VaultManager {
    constructor(private app: App) { }

    /**
     * Gets a high-level overview of the vault structure.
     */
    getVaultOverview(): { folders: string[], fileCount: number, recentFiles: string[], allFiles: string[] } {
        const files = this.app.vault.getMarkdownFiles();
        const folders = new Set<string>();

        files.forEach(file => {
            const parts = file.path.split('/');
            if (parts.length > 1) {
                // Add all folder levels
                for (let i = 0; i < parts.length - 1; i++) {
                    folders.add(parts.slice(0, i + 1).join('/'));
                }
            }
        });

        // Get recent files (sorted by modification time)
        const recentFiles = files
            .sort((a, b) => b.stat.mtime - a.stat.mtime)
            .slice(0, 20)
            .map(f => f.path);

        return {
            folders: Array.from(folders).sort(),
            fileCount: files.length,
            recentFiles,
            allFiles: files.map(f => f.path).sort()
        };
    }

    /**
     * Searches the vault for a query and returns relevant file paths.
     */
    async searchVault(query: string): Promise<SearchResult[]> {
        const files = this.app.vault.getMarkdownFiles();
        const search = prepareFuzzySearch(query);
        const results: SearchResult[] = [];

        for (const file of files) {
            const result = search(file.path);
            if (result) {
                results.push({
                    path: file.path,
                    score: result.score,
                });
            }
        }

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
    }

    /**
     * Reads the full content of a file.
     */
    async readFile(path: NotePath): Promise<string | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return await this.app.vault.read(file);
        }
        return null;
    }

    /**
     * Returns the structure of a note (headings and frontmatter).
     */
    async getNoteOutline(path: NotePath): Promise<NoteOutline | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;

        const cache = this.app.metadataCache.getFileCache(file);
        const sections: SectionId[] = [];
        const headingCounts: Record<string, number> = {};

        if (cache?.headings) {
            for (const h of cache.headings) {
                const text = h.heading;
                headingCounts[text] = (headingCounts[text] || 0) + 1;
                sections.push({
                    heading: text,
                    index: headingCounts[text] - 1
                });
            }
        }

        return {
            title: file.basename,
            sections,
            frontmatter: cache?.frontmatter || {}
        };
    }

    /**
     * Finds notes linked to or from the target path.
     */
    async readNeighborNotes(path: NotePath): Promise<{ path: NotePath, snippet: string }[]> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return [];

        const neighbors: Set<string> = new Set();
        const cache = this.app.metadataCache.getFileCache(file);

        // Outgoing links
        if (cache?.links) {
            cache.links.forEach(l => neighbors.add(l.link));
        }

        // Incoming links (backlinks)
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
            if (links[file.path]) {
                neighbors.add(sourcePath);
            }
        }

        const results: { path: NotePath, snippet: string }[] = [];
        for (const nPath of Array.from(neighbors).slice(0, 5)) {
            const nFile = this.app.vault.getAbstractFileByPath(nPath);
            if (nFile instanceof TFile) {
                const content = await this.app.vault.read(nFile);
                results.push({
                    path: nPath,
                    snippet: content.slice(0, 200) + "..."
                });
            }
        }
        return results;
    }

    /**
     * Search using Omnisearch if available (includes PDF content).
     */
    async searchWithOmnisearch(query: string): Promise<any[]> {
        try {
            const omnisearch = (this.app as any).plugins?.plugins?.['omnisearch'];
            if (!omnisearch) {
                return [];
            }

            // Omnisearch API: search and get results
            const api = omnisearch.api;
            if (!api || !api.search) {
                console.warn('[VaultManager] Omnisearch found but API not available');
                return [];
            }

            const results = await api.search(query);

            // Format results with file path, content, and score
            return results.map((result: any) => ({
                path: result.path || result.basename,
                content: result.content || result.excerpt || '',
                score: result.score,
                matches: result.matches,
                foundWords: result.foundWords
            }));
        } catch (error) {
            console.error('[VaultManager] Omnisearch query failed:', error);
            return [];
        }
    }

    /**
     * Check if Omnisearch plugin is installed and active.
     */
    isOmnisearchAvailable(): boolean {
        return !!(this.app as any).plugins?.plugins?.['omnisearch'];
    }

    /**
     * Lists all available Obsidian commands (including from other plugins).
     */
    listAvailableCommands(): { id: string, name: string }[] {
        const commands = (this.app as any).commands?.commands;
        if (!commands) return [];

        return Object.keys(commands).map(id => ({
            id,
            name: commands[id].name || id
        }));
    }

    /**
     * Executes an Obsidian command by ID.
     */
    async executeCommand(commandId: string): Promise<boolean> {
        try {
            await (this.app as any).commands.executeCommandById(commandId);
            return true;
        } catch (error) {
            console.error(`Failed to execute command ${commandId}:`, error);
            return false;
        }
    }

    /**
     * Creates a new markdown note from content.
     */
    async createNote(path: NotePath, content: string): Promise<boolean> {
        try {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file) {
                // File already exists
                return false;
            }

            // Create parent folders if needed
            const parts = path.split('/');
            if (parts.length > 1) {
                const folderPath = parts.slice(0, -1).join('/');
                try {
                    await this.app.vault.createFolder(folderPath);
                } catch (e) {
                    // Folder might already exist, that's ok
                }
            }

            await this.app.vault.create(path, content);
            return true;
        } catch (error) {
            console.error('[VaultManager] Failed to create note:', error);
            return false;
        }
    }

    /**
     * Patches or appends content to a specific section identified by Header + Index.
     */
    async patchSection(path: NotePath, section: SectionId, content: string): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return false;

        const fileContent = await this.app.vault.read(file);
        const lines = fileContent.split("\n");
        const headerRegex = new RegExp(`^#+\\s+${section.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

        let foundCount = 0;
        let headerIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            if (headerRegex.test(lines[i])) {
                if (foundCount === section.index) {
                    headerIndex = i;
                    break;
                }
                foundCount++;
            }
        }

        if (headerIndex === -1) {
            // Header not found at that index, append to end
            await this.app.vault.modify(file, fileContent + `\n\n## ${section.heading}\n${content}`);
            return true;
        }

        // Find the start of the next header of same or higher level
        const currentHeaderLine = lines[headerIndex];
        const currentLevel = (currentHeaderLine.match(/^#+/) || [""])[0].length;

        let nextHeaderIndex = lines.findIndex((line, idx) => {
            if (idx <= headerIndex) return false;
            const match = line.match(/^#+/);
            if (!match) return false;
            return match[0].length <= currentLevel;
        });

        if (nextHeaderIndex === -1) nextHeaderIndex = lines.length;

        // Replace content between current and next header
        const newLines = [
            ...lines.slice(0, headerIndex + 1),
            content,
            ...lines.slice(nextHeaderIndex)
        ];

        await this.app.vault.modify(file, newLines.join("\n"));
        return true;
    }
}

export const VAULT_TOOLS: ToolDefinition[] = [
    {
        type: "function",
        function: {
            name: "search_omnisearch",
            description: "Search vault content using Omnisearch (includes PDFs, images with text, and all indexed content). More powerful than search_vault. Use this to find content in PDFs.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The search query." }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_note",
            description: "Create a new markdown note with the given content. Perfect for extracting PDF sections into clean notes.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path for the new note (e.g., 'Extracted/PDF Name - Section.md')" },
                    content: { type: "string", description: "The markdown content for the note." }
                },
                required: ["path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_commands",
            description: "List all available Obsidian commands, including those from other plugins. Use this to find commands for PDF conversion, image processing, etc.",
            parameters: {
                type: "object",
                properties: {
                    filter: { type: "string", description: "Optional filter keyword to search for specific commands (e.g., 'pdf', 'convert', 'export')" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "execute_command",
            description: "Execute an Obsidian command by its ID. Use list_commands first to find the command ID. Great for triggering other plugins like PDF converters.",
            parameters: {
                type: "object",
                properties: {
                    command_id: { type: "string", description: "The command ID to execute (e.g., 'obsidian-pdf-export:export')" }
                },
                required: ["command_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "search_vault",
            description: "Search for notes in the vault by keywords or fuzzy matching. Returns a list of file paths.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The search query." }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Read the full contents of a note by its path.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "The absolute path of the file." }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_note_outline",
            description: "Get the list of headings and frontmatter for a note. Use this to find specific sections to patch.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the file." }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_neighbor_notes",
            description: "Find notes that are linked to or from a given note. Useful for cross-referencing consistency.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the file." }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "patch_note_section",
            description: "Update or append content to a specific section in a note identified by heading and index.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the file." },
                    section: {
                        type: "object",
                        properties: {
                            heading: { type: "string" },
                            index: { type: "integer" }
                        },
                        required: ["heading", "index"]
                    },
                    content: { type: "string", description: "The new markdown content." }
                },
                required: ["path", "section", "content"]
            }
        }
    }
];
