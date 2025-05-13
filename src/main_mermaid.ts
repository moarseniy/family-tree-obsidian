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

class MermaidView extends ItemView {
    private mermaidContent: string;

    constructor(leaf: WorkspaceLeaf, private settings: MermaidViewSettings) {
        super(leaf);
    }

    getViewType(): string {
        return 'mermaid-view';
    }

    getDisplayText(): string {
        return 'Mermaid Diagram';
    }

    async setContent(content: string): Promise<void> {
        this.mermaidContent = content;
        await this.drawMermaid();
    }

    private async drawMermaid(): Promise<void> {
        try {
            console.log('Starting render...');
            const container = this.containerEl.children[1] as HTMLElement;
            container.empty();

            const mermaidDiv = container.createDiv('mermaid-container');
            mermaidDiv.style.width = `${this.settings.defaultWidth}px`;
            mermaidDiv.style.height = `${this.settings.defaultHeight}px`;
            mermaidDiv.style.overflow = 'hidden';

            // @ts-ignore
            const { mermaid } = window;
            mermaid.initialize({ startOnLoad: false, theme: 'default' });

            const sanitized = this.mermaidContent.trim();
            console.log('Sanitized content:', sanitized.slice(0, 50));

            const { svg } = await mermaid.render(
                `mermaid-${Date.now()}`,
                sanitized
            );

            mermaidDiv.innerHTML = svg;
            console.log('Render completed');

            // Apply pan and zoom
            const svgEl = mermaidDiv.querySelector('svg');
            if (svgEl) {
                panzoom(svgEl, {
                    bounds: true,
                    boundsPadding: 0.1
                });
                console.log('PanZoom applied');
            }
        } catch (error) {
            console.error('Render error:', error);
            this.containerEl.setText(`Error: ${error.message}`);
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
                console.log('Mermaid loaded:', window.mermaid);
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

        this.addRibbonIcon('network', 'Show Mermaid', () => {
            this.openMermaidView();
        });

        this.addSettingTab(new MermaidSettingsTab(this.app, this));
    }

    onunload() {
        console.log('Closing Mermaid view');
    }

    private async openMermaidView() {
        try {
            console.log('Opening Mermaid view...');
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                new Notice('No active file');
                return;
            }

            const content = await this.app.vault.read(activeFile);
            console.log('File content:', content.slice(0, 100));

            const mermaidBlocks = this.extractMermaidBlocks(content);
            console.log('Found blocks:', mermaidBlocks);

            if (mermaidBlocks.length > 0) {
                const leaf = this.app.workspace.getLeaf(true);
                console.log('Leaf created:', leaf);

                const view = new MermaidView(leaf, this.settings);
                await leaf.open(view);
                console.log('View opened');

                await view.setContent(mermaidBlocks[0]);
                console.log('Content set');
            } else {
                new Notice('No mermaid diagrams found');
            }
        } catch (error) {
            console.error('Main error:', error);
            new Notice(`Error: ${error.message}`);
        }
    }

    private extractMermaidBlocks(content: string): string[] {
        const regex = /```mermaid\s*\n?([\s\S]*?)\n?```/g;
        const matches: string[] = [];
        let match;

        while ((match = regex.exec(content)) !== null) {
            let diagram = match[1]
                .trim()
                .replace(/^graph/gm, 'flowchart');

            diagram = diagram.replace(/^\s*\n/g, '');
            matches.push(diagram);
        }

        return matches;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class MermaidSettingsTab extends PluginSettingTab {
    plugin: MermaidDiagramPlugin;

    constructor(app: App, plugin: MermaidDiagramPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Default Width')
            .setDesc('Default width for diagram window')
            .addText(text => text
                .setValue(String(this.plugin.settings.defaultWidth))
                .onChange(async (value) => {
                    this.plugin.settings.defaultWidth = Number(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Height')
            .setDesc('Default height for diagram window')
            .addText(text => text
                .setValue(String(this.plugin.settings.defaultHeight))
                .onChange(async (value) => {
                    this.plugin.settings.defaultHeight = Number(value);
                    await this.plugin.saveSettings();
                }));
    }
}
