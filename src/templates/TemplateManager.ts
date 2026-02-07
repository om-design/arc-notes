import { App, TFile } from "obsidian";
import * as yaml from "yaml";

export interface TemplateDefinition {
    name: string;
    description: string;
    folder: string;
    frontmatter: Record<string, any>;
    sections: Array<{
        name: string;
        description: string;
    }>;
    interview: {
        opening: string;
        flow: Array<{
            stage: string;
            purpose: string;
            question?: string;
            questions?: string[];
            approach?: string;
            reflection?: string;
            field?: string;
            mapping?: Record<string, string>;
            sections_to_fill?: Record<string, string>;
        }>;
        closing: string;
    };
    // ai_instructions is now global
}

export class TemplateManager {
    private templates: Map<string, TemplateDefinition> = new Map();
    private globalInstructions: string = "";

    constructor(private app: App, private pluginDir: string) {}

    async loadTemplates(): Promise<void> {
        const templatesDir = `${this.pluginDir}/templates`;

        try {
            // Load global instructions
            const globalPromptPath = `${templatesDir}/global-interview-prompt.md`;
            try {
                const globalPromptFile = this.app.vault.getAbstractFileByPath(globalPromptPath);
                if (globalPromptFile instanceof TFile) {
                    this.globalInstructions = await this.app.vault.read(globalPromptFile);
                    console.log(`[TemplateManager] Loaded global interview prompt.`);
                } else {
                    console.error(`[TemplateManager] Global prompt file not found at ${globalPromptPath}`);
                }
            } catch (error) {
                console.error(`[TemplateManager] Failed to load global prompt:`, error);
            }


            // Load template files
            const templateFiles = this.app.vault.getFiles().filter(f =>
                f.path.startsWith(templatesDir) && f.path.endsWith('.yaml')
            );

            for (const templateFile of templateFiles) {
                try {
                    const content = await this.app.vault.read(templateFile);
                    const parsed = yaml.parse(content) as TemplateDefinition;
                    this.templates.set(parsed.name, parsed);
                    console.log(`[TemplateManager] Loaded template: ${parsed.name}`);
                } catch (error) {
                    console.error(`[TemplateManager] Failed to parse ${templateFile.path}:`, error);
                }
            }
        } catch (error) {
            console.error('[TemplateManager] Failed to load templates:', error);
        }
    }

    getTemplate(name: string): TemplateDefinition | undefined {
        return this.templates.get(name);
    }

    listTemplates(): TemplateDefinition[] {
        return Array.from(this.templates.values());
    }

    /**
     * Generate the initial interview prompt for a template
     */
    getInterviewPrompt(template: TemplateDefinition): string {
        return `${template.interview.opening}

**Template:** ${template.name} - ${template.description}

I'll guide you through creating this note with a conversation. Ready to begin?`;
    }

    /**
     * Generate the system prompt for conducting an interview
     */
    getInterviewSystemPrompt(template: TemplateDefinition): string {
        return `You are conducting a conversational interview to create a structured note.

${this.globalInstructions}

# Template Context:
Template Name: ${template.name}
Description: ${template.description}

# Interview Flow:

${template.interview.flow.map(stage => `
## Stage: ${stage.stage}
Purpose: ${stage.purpose}
${stage.question ? `Question: ${stage.question}` : ''}
${stage.questions ? `Questions:\n${stage.questions.map(q => `- ${q}`).join('\n')}` : ''}
${stage.approach ? `Approach:\n${stage.approach}` : ''}
${stage.reflection ? `Reflection: ${stage.reflection}` : ''}
${stage.field ? `This populates: ${stage.field}` : ''}
`).join('\n')}

# Sections to Create:
${template.sections.map(s => `- ${s.name}: ${s.description}`).join('\n')}

# Frontmatter Structure:
${Object.entries(template.frontmatter).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`).join('\n')}

Remember:
- This is a conversation, not a form
- Adapt your questions based on user expertise
- Reflect understanding back
- Use natural language
- Build progressively
- The goal is to gather information to fill all sections and frontmatter

When you have enough information, say "Let me create the note" and generate the complete markdown content.`;
    }

    /**
     * Generate a note from interview data
     */
    generateNote(template: TemplateDefinition, data: {
        frontmatter: Record<string, any>;
        sections: Record<string, string>;
    }): string {
        // Generate frontmatter
        const frontmatterLines = ['---'];
        for (const [key, value] of Object.entries(data.frontmatter)) {
            if (Array.isArray(value)) {
                if (value.length === 0) {
                    frontmatterLines.push(`${key}: []`);
                } else {
                    frontmatterLines.push(`${key}:`);
                    value.forEach(v => frontmatterLines.push(`  - ${v}`));
                }
            } else if (key === 'created' && value === '{{date}}') {
                frontmatterLines.push(`${key}: ${new Date().toISOString().split('T')[0]}`);
            } else {
                frontmatterLines.push(`${key}: ${value}`);
            }
        }
        frontmatterLines.push('---');
        frontmatterLines.push('');

        // Generate sections
        const sectionLines: string[] = [];
        for (const section of template.sections) {
            sectionLines.push(`## ${section.name}`);
            sectionLines.push('');
            sectionLines.push(data.sections[section.name] || '');
            sectionLines.push('');
        }

        return frontmatterLines.join('\n') + sectionLines.join('\n');
    }
}
