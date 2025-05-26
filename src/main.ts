import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import panzoom from 'panzoom';
import mermaid from 'mermaid';

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
              maxTextSize: 100000,
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

          // 2) That rawName should exactly match your file's basename
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

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    private getMimeType(extension: string): string {
        const map: Record<string, string> = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp'
        };
        return map[extension.toLowerCase()] || 'application/octet-stream';
    }

    private async resizeImage(file: TFile, maxWidth: number, maxHeight: number): Promise<string> {
        const arrayBuffer = await this.app.vault.readBinary(file);
        const blob = new Blob([arrayBuffer]);
        const url = URL.createObjectURL(blob);
        
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Calculate new sizes with proportions
                let width = img.width;
                let height = img.height;
                
                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                ctx.drawImage(img, 0, 0, width, height);
                
                // Return compressed image in base format
                resolve(canvas.toDataURL('image/jpeg', 0.7)); // 0.7 quality
                
                // Free URL
                URL.revokeObjectURL(url);
            };
            
            img.onerror = reject;
            img.src = url;
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
        // Вспомогательные функции без изменений
        function arrayBufferToBase64(buffer: ArrayBuffer): string {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return window.btoa(binary);
        }

        function getMimeType(extension: string): string {
            const map: Record<string, string> = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'svg': 'image/svg+xml',
                'webp': 'image/webp'
            };
            return map[extension.toLowerCase()] || 'application/octet-stream';
        }

        const files = this.app.vault.getMarkdownFiles();
        const nodes = new Set<string>();
        const links: string[] = [];
        
        // Словарь ключ-значение для обработанных файлов
        type PersonInfo = {
            id: string;
            motherId?: string;
            fatherId?: string;
        };
        
        const people: PersonInfo[] = [];

        // Первый проход - собираем все узлы и связи
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
                    try {
                        const arrayBuffer = await this.app.vault.readBinary(imgFile);
                        const blob = new Blob([arrayBuffer]);
                        const url = URL.createObjectURL(blob);
                        
                        const dataUri = await new Promise<string>((resolve, reject) => {
                            const img = new Image();
                            img.onload = () => {
                                const size = 256;
                                
                                const canvas = document.createElement('canvas');
                                canvas.width = size;
                                canvas.height = size;
                                const ctx = canvas.getContext('2d');
                                
                                let sx = 0, sy = 0, sSize = img.width;
                                if (img.width > img.height) {
                                    sx = (img.width - img.height) / 2;
                                    sSize = img.height;
                                } else {
                                    sy = (img.height - img.width) / 2;
                                    sSize = img.width;
                                }
                                
                                ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, size, size);
                                
                                resolve(canvas.toDataURL('image/jpeg', 0.5));
                                URL.revokeObjectURL(url);
                            };
                            img.onerror = reject;
                            img.src = url;
                        });
                        
                        imageUrl = dataUri;
                    } catch (err) {
                        console.error('Error processing image:', err);
                    }
                } else {
                    console.warn('Could not resolve TFile for', filename);
                }
            }

            const childName = file.basename;
            const childId = createNodeId(childName);

            const label = imageUrl
                ? `%%{html:true}%%<div style="text-align: center; margin: 0">
                    <img src="${imageUrl}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px;"/>
                    <br/>
                    <span style="font-size: 12px">${childName}</span>
                  </div>`
                : childName;

            console.log('Generated label:', label);
            
            nodes.add(`${childId}["${label}"]`);

            const headingLevel = parentsMatch[1].length;
            const startIndex = content.indexOf(parentsMatch[0]) + parentsMatch[0].length;
            const section = content.slice(startIndex);
            const lines = section.split(/\r?\n/);

            // Информация о текущем человеке
            const person: PersonInfo = { id: childId };

            for (const line of lines) {
                if (new RegExp(`^#{${headingLevel}}\s+`).test(line) && !/^#+\s*Родители/.test(line)) {
                    break;
                }

                const motherMatch = line.match(/^\s*-\s*Мать\s*:\s*\[\[([^\]]+)\]\]/i);
                const fatherMatch = line.match(/^\s*-\s*Отец\s*:\s*\[\[([^\]]+)\]\]/i);
                
                if (motherMatch) {
                    const motherName = motherMatch[1];
                    const motherId = createNodeId(motherName);
                    nodes.add(`${motherId}["${motherName}"]`);
                    person.motherId = motherId;
                }
                
                if (fatherMatch) {
                    const fatherName = fatherMatch[1];
                    const fatherId = createNodeId(fatherName);
                    nodes.add(`${fatherId}["${fatherName}"]`);
                    person.fatherId = fatherId;
                }
            }

            people.push(person);
        }

        // Второй проход - создаем связи
        for (const person of people) {
            // Если есть оба родителя, создаем промежуточную точку
            if (person.motherId && person.fatherId) {
                // Добавляем точку по середине между родителями
                const midpointId = `mid_${person.id}`;
                nodes.add(`${midpointId}((.))`);
                
                // Связываем родителей с этой точкой
                links.push(`${person.motherId} --> ${midpointId}`);
                links.push(`${person.fatherId} --> ${midpointId}`);
                
                // А эту точку с ребенком
                links.push(`${midpointId} --> ${person.id}`);
            } else {
                // Если только один родитель, связываем напрямую
                if (person.motherId) {
                    links.push(`${person.motherId} --> ${person.id}`);
                }
                if (person.fatherId) {
                    links.push(`${person.fatherId} --> ${person.id}`);
                }
            }
        }

        if (nodes.size === 0) {
            return '';
        }

        // Формируем диаграмму
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