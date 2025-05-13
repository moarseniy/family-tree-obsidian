import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import panzoom from 'panzoom';

interface MermaidViewSettings {
    defaultWidth: number;
    defaultHeight: number;
}

const DEFAULT_SETTINGS: MermaidViewSettings = {
    defaultWidth: 800,
    defaultHeight: 600
};

/**
 * Генерирует числовой хеш из строки
 */
function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return Math.abs(hash);
}

/**
 * Создаёт уникальный ID на основе имени и хеша
 */
function createNodeId(name: string): string {
    const base = name.trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '');
    return `${base}_${hashCode(name)}`;
}

class MermaidView extends ItemView {
    private mermaidContent: string;

    constructor(leaf: WorkspaceLeaf, private settings: MermaidViewSettings) {
        super(leaf);
    }

    getViewType(): string { return 'mermaid-view'; }
    getDisplayText(): string { return 'Mermaid Diagram (v3)'; }

    async setContent(content: string): Promise<void> {
        this.mermaidContent = content;
        console.log('Mermaid content:', content);
        await this.drawMermaid();
    }

    private async drawMermaid(): Promise<void> {
        try {
            this.contentEl.empty();
            console.log('Rendering Mermaid SVG');

            const mermaidDiv = this.contentEl.createDiv('mermaid-container');
            mermaidDiv.style.overflow = 'visible';

            // @ts-ignore
            const { mermaid } = window;
            mermaid.initialize({ startOnLoad: false, theme: 'default' });

            const id = `mermaid-${Date.now()}`;
            const { svg } = await mermaid.render(id, this.mermaidContent);
            mermaidDiv.innerHTML = svg;

            const svgEl = mermaidDiv.querySelector('svg');
            if (svgEl) {
                const bbox = svgEl.getBBox();
                mermaidDiv.style.width  = `${bbox.width}px`;
                mermaidDiv.style.height = `${bbox.height}px`;
                panzoom(svgEl, { bounds: false });
            }
        } catch (error) {
            console.error('Render error:', error);
            this.contentEl.setText(`Error: ${error.message}`);
            throw error;
        }
    }
}

export default class MermaidDiagramPlugin extends Plugin {
    settings: MermaidViewSettings;

    private async loadMermaid() {
        try {
            // @ts-ignore
            if (!window.mermaid) {
                // @ts-ignore
                window.mermaid = await import('mermaid');
            }
            return true;
        } catch (e) {
            console.error('Mermaid load error:', e);
            return false;
        }
    }

    async onload() {
        await this.loadSettings();
        if (!await this.loadMermaid()) {
            new Notice('Failed to load Mermaid.js');
            return;
        }
        this.addRibbonIcon('network', 'Show Mermaid', () => this.openMermaidView());
        this.addSettingTab(new MermaidSettingsTab(this.app, this));
    }

    onunload() { console.log('Mermaid plugin unloaded'); }

    private async openMermaidView() {
        try {
            const diagram = await this.buildFamilyGraph();
            console.log('Built diagram:', diagram);
            if (!diagram) {
                new Notice('No notes with # Родители found');
                return;
            }

            const leaf = this.app.workspace.getLeaf(true);
            const view = new MermaidView(leaf, this.settings);
            await leaf.open(view);
            await view.setContent(diagram);
        } catch (e) {
            console.error('Error opening view:', e);
            new Notice(`Error: ${e.message}`);
        }
    }

    private async buildFamilyGraph(): Promise<string> {
        const files = this.app.vault.getMarkdownFiles();
        const nodes = new Set<string>();
        const links: string[] = [];

        for (const file of files) {
            const content = await this.app.vault.read(file);
            const parentsMatch = content.match(/^(#+)\s*Родители/m);
            if (!parentsMatch) continue;

            const headingLevel = parentsMatch[1].length;
            const startIndex = content.indexOf(parentsMatch[0]) + parentsMatch[0].length;
            const section = content.slice(startIndex);
            const lines = section.split(/\r?\n/);

            const childName = file.basename;
            const childId = createNodeId(childName);
            nodes.add(`${childId}["${childName}"]`);

            for (const line of lines) {
                if (new RegExp(`^#{${headingLevel}}\s+`).test(line) && !/^#+\s*Родители/.test(line)) {
                    break;
                }

                const motherMatch = line.match(/^\s*-\s*Мать\s*:\s*\[\[([^\]]+)\]\]/i);
                const fatherMatch = line.match(/^\s*-\s*Отец\s*:\s*\[\[([^\]]+)\]\]/i);
                if (motherMatch) {
                    const parentName = motherMatch[1];
                    const parentId = createNodeId(parentName);
                    nodes.add(`${parentId}["${parentName}"]`);
                    links.push(`${parentId} --> ${childId}`);
                }
                if (fatherMatch) {
                    const parentName = fatherMatch[1];
                    const parentId = createNodeId(parentName);
                    nodes.add(`${parentId}["${parentName}"]`);
                    links.push(`${parentId} --> ${childId}`);
                }
            }
        }

        if (nodes.size === 0) {
            return '';
        }
        const diagram: string[] = ['flowchart TD', ...Array.from(nodes), ...links];
        return diagram.join('\n');
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
}

class MermaidSettingsTab extends PluginSettingTab {
    plugin: MermaidDiagramPlugin;
    constructor(app: App, plugin: MermaidDiagramPlugin) { super(app, plugin); this.plugin = plugin; }
    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        new Setting(containerEl)
            .setName('Default Width')
            .setDesc('Default width for diagram window')
            .addText(text => text
                .setValue(String(this.plugin.settings.defaultWidth))
                .onChange(async (v) => { this.plugin.settings.defaultWidth = Number(v); await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Default Height')
            .setDesc('Default height for diagram window')
            .addText(text => text
                .setValue(String(this.plugin.settings.defaultHeight))
                .onChange(async (v) => { this.plugin.settings.defaultHeight = Number(v); await this.plugin.saveSettings(); }));
    }
}