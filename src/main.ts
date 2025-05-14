import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import panzoom from 'panzoom';

interface MermaidViewSettings {
  defaultWidth: number;
  defaultHeight: number;
  nodeSpacing: number;
  rankSpacing: number;
}

const DEFAULT_SETTINGS: MermaidViewSettings = {
  defaultWidth: 800,
  defaultHeight: 600,
  nodeSpacing: 140,
  rankSpacing:  220
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
    // Кодируем спецсимволы кроме пробелов
    const base = encodeURIComponent(name.trim())
        .replace(/%20/g, '_')  // Заменяем пробелы на подчеркивания
        .replace(/[^a-zA-Z0-9_]/g, '');  // Удаляем оставшиеся спецсимволы
    
    return `${base}_${hashCode(name)}`;
}

class MermaidView extends ItemView {
    private mermaidContent: string;
    private diagramId: string;

    constructor(leaf: WorkspaceLeaf, private settings: MermaidViewSettings) {
        super(leaf);
    }

    getViewType(): string { return 'mermaid-view'; }
    getDisplayText(): string { return 'Mermaid Diagram (v3)'; }

    async setContent(content: string): Promise<void> {
        this.mermaidContent = content;
        // console.log('Mermaid content:', content);
        await this.drawMermaid();
    }

    private async drawMermaid(): Promise<void> {
        try {
            this.contentEl.empty();
            const mermaidDiv = this.contentEl.createDiv('mermaid-container');
            mermaidDiv.style.overflow = 'visible';

            // @ts-ignore
            const { mermaid } = window;

            mermaid.initialize({
              startOnLoad: false,
              theme: 'default',
              securityLevel: 'loose',
              flowchart: {
                htmlLabels:   true,
                nodeSpacing: this.settings.nodeSpacing, // ↑ horizontal spacing
                rankSpacing:  this.settings.rankSpacing // ↑ vertical spacing
              }
            });

            const id = `mermaid-${Date.now()}`;
            this.diagramId = id;  // ← запоминаем container ID
            const { svg } = await mermaid.render(id, this.mermaidContent);
            mermaidDiv.innerHTML = svg;

            this.addNodeClickHandlers(mermaidDiv);

            const svgEl = mermaidDiv.querySelector('svg');
            if (svgEl) {
                panzoom(svgEl, { bounds: false });
            }
        } catch (error) {
            console.error('Render error:', error);
            this.contentEl.setText(`Error: ${error.message}`);
            throw error;
        }
    }

    private addNodeClickHandlers(container: HTMLElement) {
      container.querySelectorAll<SVGGElement>('g.node').forEach(node => {
        node.style.cursor = 'pointer';

        node.addEventListener('click', async () => {
          // 1) Pull every bit of text inside this <g>
          const rawName = (node.textContent || '').trim();
          if (!rawName) {
            new Notice('🛑 Empty label on node');
            console.log('[Mermaid] Node innerHTML:', node.innerHTML);
            return;
          }

          // 2) That rawName should exactly match your file’s basename
          const noteName = rawName;

          // 3) Find & open the file
          const noteFile = this.app.vault
            .getMarkdownFiles()
            .find(f => f.basename === noteName);

          if (noteFile) {
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(noteFile);
          } else {
            new Notice(`Note "${noteName}" not found`);
            console.log('[Mermaid] clicked node label:', noteName, 'but no file was found.');
          }
        });
      });
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
            // console.log('Built diagram:', diagram);
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

            let imageUrl: string | undefined;
            let filename: string | undefined;

            const imgRegex = /!\[\[(.+?\.(?:png|jpe?g|gif|svg|bmp|webp))\]\]/gi;
            let match: RegExpExecArray | null;

            while ((match = imgRegex.exec(content)) !== null) {
              filename = match[1];
              console.log('Found image filename:', filename);
            }

            if (filename) {
              const imgFile = this.app.metadataCache.getFirstLinkpathDest(filename, file.path);
              if (imgFile instanceof TFile) {
                imageUrl = this.app.vault.getResourcePath(imgFile);
                

                // Добавляем хак для локальных URI
                if (imageUrl.startsWith('app://')) {
                    imageUrl = imageUrl.replace('app://local/', 'http://localhost/');
                console.log('Resolved image URL:', imageUrl);
            }
              } else {
                console.warn('Could not resolve TFile for', filename);
              }
            }

            const headingLevel = parentsMatch[1].length;
            const startIndex = content.indexOf(parentsMatch[0]) + parentsMatch[0].length;
            const section = content.slice(startIndex);
            const lines = section.split(/\r?\n/);

            const childName = file.basename;
            const childId = createNodeId(childName)
            const label = imageUrl
                ? `%%{html:true}%%<div style="text-align: center; margin: 0">
                    <img src="${imageUrl}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px;"/>
                    <br/>
                    <span style="font-size: 12px">${childName}</span>
                  </div>`
                : childName;

            console.log('Generated label:', label);

            nodes.add(`${childId}["${label}"]`);

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
        new Setting(containerEl)
            .setName('Node Spacing')
            .setDesc('Horizontal gap (px) between nodes')
            .addText(text => text
                .setValue(String(this.plugin.settings.nodeSpacing))
                .onChange(async (v) => { this.plugin.settings.nodeSpacing = Number(v); await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Node Spacing')
            .setDesc('Vertical gap (px) between ranks/rows')
            .addText(text => text
                .setValue(String(this.plugin.settings.rankSpacing))
                .onChange(async (v) => { this.plugin.settings.rankSpacing = Number(v); await this.plugin.saveSettings(); }));            
    }
}