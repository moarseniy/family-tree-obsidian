import { Plugin, TFile, WorkspaceLeaf, ItemView } from 'obsidian';
import * as d3 from 'd3';

interface Person {
  id: string;
  name: string;
  mother: string | null;
  father: string | null;
  children: string[];
  hasParentsSection: boolean;
  gender?: 'male' | 'female';
}

export default class FamilyTreePlugin extends Plugin {
  private people: Person[] = [];

  async onload() {
    this.registerView('family-tree', (leaf) => new FamilyTreeView(leaf, this));
    this.addRibbonIcon('users', 'Show Tree', () => this.activateView());
  }

  async activateView() {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: 'family-tree' });
    this.app.workspace.revealLeaf(leaf);
  }

  private async loadPeople(): Promise<Person[]> {
    const people: Person[] = [];
    const seen = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.read(file);
      const { mother, father, hasSection } = this.parseParents(content);
      if (!hasSection) continue;
      const id = file.basename;
      if (seen.has(id)) continue;
      seen.add(id);
      people.push({ id, name: id, mother, father, children: [], hasParentsSection: true });
    }
    const mentioned = new Set<string>(people.flatMap(p => [p.mother, p.father].filter(Boolean) as string[]));
    for (const id of mentioned) {
      if (!seen.has(id)) {
        seen.add(id);
        people.push({ id, name: id, mother: null, father: null, children: [], hasParentsSection: false });
      }
    }
    const map = new Map(people.map(p => [p.id, p]));
    for (const p of people) {
      for (const pid of [p.mother, p.father]) {
        if (pid && map.has(pid)) {
          const parent = map.get(pid)!;
          if (!parent.children.includes(p.id)) parent.children.push(p.id);
        }
      }
    }
    this.people = people;
    return people;
  }

  private parseParents(content: string) {
    const result = { mother: null as string | null, father: null as string | null, hasSection: false };
    const match = content.match(/(^|\n)#+\s*Родители\s*\n([\s\S]*?)(?=\n#|$)/i);
    if (!match) return result;
    result.hasSection = true;
    const block = match[2];
    const momMatch = block.match(/^[*-]\s*Мать\s*:\s*\[\[(.*?)\]\]/im);
    const dadMatch = block.match(/^[*-]\s*Отец\s*:\s*\[\[(.*?)\]\]/im);
    if (momMatch) result.mother = momMatch[1].split('|')[0].trim();
    if (dadMatch) result.father = dadMatch[1].split('|')[0].trim();
    return result;
  }
}

class FamilyTreeView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: FamilyTreePlugin) {
    super(leaf);
  }

  getViewType() { return 'family-tree'; }
  getDisplayText() { return 'Family Tree'; }
  getIcon() { return 'users'; }

  async onOpen() {
    await this.drawTree();
  }

  private determineGender(person: Person, all: Person[]): 'male' | 'female' {
    if (all.some(p => p.mother === person.id)) return 'female';
    if (all.some(p => p.father === person.id)) return 'male';
    return person.name.toLowerCase().endsWith('а') || person.name.toLowerCase().endsWith('я') ? 'female' : 'male';
  }

  private async drawTree() {
    const container = this.containerEl.children[1];
    container.empty();
    container.style.overflow = 'hidden';

    const people = await this.plugin.loadPeople();
    if (!people.length) return;
    people.forEach(p => { if (!p.gender) p.gender = this.determineGender(p, people); });

    // Prepare nodes and links
    const nodes = people.map(p => ({ ...p }));
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const links = people.flatMap(p => {
      const arr: Array<{ source: string; target: string }> = [];
      if (p.mother) arr.push({ source: p.mother, target: p.id });
      if (p.father) arr.push({ source: p.father, target: p.id });
      return arr;
    }).filter(l => nodeMap.has(l.source) && nodeMap.has(l.target));

    // Compute depth for vertical levels
    const depth = new Map<string, number>();
    const roots = people.filter(p => !p.mother && !p.father).map(p => p.id);
    const q = [...roots]; depth.set(roots[0]||'', 0);
    roots.forEach(id => depth.set(id, 0));
    while (q.length) {
      const id = q.shift()!;
      const d = depth.get(id)!;
      links.filter(l => l.source === id).forEach(l => {
        if (!depth.has(l.target)) { depth.set(l.target, d+1); q.push(l.target); }
      });
    }

    // SVG & Zoom
    const rect = container.getBoundingClientRect();
    const width = rect.width || 800, height = rect.height || 600;
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const g = svg.append('g');
    svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.5,2]).on('zoom', e=> g.attr('transform', e.transform)));

    // Force layout
    const sim = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d:any)=>d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('x', d3.forceX(width/2).strength(0.1))
      .force('y', d3.forceY().y((d:any)=> (depth.get(d.id)||0)*100 ).strength(1))
      .force('collide', d3.forceCollide().radius(80));

    // Draw links
    const link = g.selectAll('line')
      .data(links).enter().append('line')
      .attr('stroke','#888').attr('stroke-width',1.5);

    // Draw nodes
    const node = g.selectAll('g.node')
      .data(nodes).enter().append('g')
      .attr('class','node')
      .call(d3.drag<SVGGElement, any>()
        .on('start',(e,d:any)=>{ if(!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
        .on('drag',(e,d:any)=>{ d.fx=e.x; d.fy=e.y; })
        .on('end',(e,d:any)=>{ if(!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; })
      )
      .on('click',(_,d:any)=> this.openNote(d.id));
    node.append('circle').attr('r',12).attr('fill',d=>d.gender==='female'? '#ff6666':'#6699cc').attr('stroke','#444').attr('stroke-width',1.5);
    node.append('text')
      .attr('dy', 20) // вместо -16 — теперь под узлом
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('fill', '#eee') // <- цвет текста
      .style('pointer-events', 'none')
      .text(d => d.name);


    sim.on('tick',()=>{
      link
        .attr('x1', d => (d.source as any).x)
        .attr('y1', d => (d.source as any).y)
        .attr('x2', d => (d.target as any).x)
        .attr('y2', d => (d.target as any).y);
      node.attr('transform', (d:any)=>`translate(${d.x},${d.y})`);
    });
  }

  private async openNote(id: string) {
    const file = this.app.vault.getAbstractFileByPath(`${id}.md`);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }
  }
}
