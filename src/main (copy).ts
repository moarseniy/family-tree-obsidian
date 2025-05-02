import { Plugin, TFile, WorkspaceLeaf, ItemView } from 'obsidian';
import * as d3 from 'd3';

// Основной интерфейс для представления человека в системе
interface Person {
  id: string;          // Уникальный идентификатор (базовое имя файла)
  name: string;        // Отображаемое имя (обычно совпадает с id)
  mother: string | null;  // Ссылка на мать (id другого человека)
  father: string | null;  // Ссылка на отца (id другого человека)
  children: string[];  // Массив идентификаторов детей
  hasParentsSection: boolean; // Флаг наличия секции родителей в файле
  gender?: 'male' | 'female'; // Новое поле
}

export default class FamilyTreePlugin extends Plugin {
  private people: Person[] = []; // Основное хранилище данных о людях

  async onload() {
    // Регистрация кастомного представления для Obsidian
    this.registerView('family-tree', (leaf) => new FamilyTreeView(leaf, this));
    // Добавление иконки в ленту для быстрого доступа
    this.addRibbonIcon('users', 'Show Tree', () => this.activateView());
  }

  // Активация и отображение представления с древом
  async activateView() {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: 'family-tree' });
    this.app.workspace.revealLeaf(leaf);
  }

  // Основной метод загрузки и обработки данных
  async loadPeople(): Promise<Person[]> {
    this.people = [];
    const files = this.app.vault.getMarkdownFiles();
    console.debug('[Family Tree] Total files found:', files.length);

    // Этап 1: Парсинг всех markdown-файлов
    for (const file of files) {
        try {
            // console.debug('[Family Tree] Processing file:', file.path);
            
            const content = await this.app.vault.read(file);
            const {mother, father, hasSection} = this.parseParents(content);
            // console.debug('[Family Tree] Parse results:', {
            //     file: file.basename,
            //     hasSection,
            //     mother,
            //     father
            // });

            // Добавление только людей с явно указанными родителями
            if (hasSection) {
                console.debug('[Family Tree] Adding person with parents section:', file.basename);
                this.people.push({
                    id: file.basename,
                    name: file.basename,
                    mother,
                    father,
                    children: [],
                    hasParentsSection: true
                });
            } else {
                // console.debug('[Family Tree] Skipping file without parents section:', file.basename);
            }

        } catch (err) {
            console.error('[Family Tree] Error processing file:', file.path, err);
        }
    }

    console.debug('[Family Tree] Initial people list:', this.people);
    
    // Этап 2: Добавление недостающих родителей
    const allMentionedIds = new Set(this.people.flatMap(p => [p.mother, p.father].filter(Boolean)));
    console.debug('[Family Tree] All mentioned IDs:', Array.from(allMentionedIds));
    
    allMentionedIds.forEach(id => {
        if (id && !this.people.some(p => p.id === id)) {
            console.debug('[Family Tree] Adding missing parent:', id);
            this.people.push({
                id: id,
                name: id,
                mother: null,
                father: null,
                children: [],
                hasParentsSection: false
            });
        }
    });

    console.debug('[Family Tree] Final people list before linking:', this.people);
    // Этап 3: Построение связей родитель-ребенок
    this.buildFamilyLinks();
    console.debug('[Family Tree] Final people list with children:', JSON.parse(JSON.stringify(this.people)));
    
    return this.people;
  }

  // Парсинг секции родителей из содержимого файла
  private parseParents(content: string): { 
    mother: string | null, 
    father: string | null,
    hasSection: boolean
  } {
    const result = {
        mother: null,
        father: null,
        hasSection: false
    };
    
    try {
        // Используем регулярные выражения для поиска:
        // 1. Наличие секции ## Родители
        // 2. Строки с Мать: [[...]] и Отец: [[...]]
        const parentsSection = content.match(/(^|\n)#+\s*Родители\s*\n([\s\S]*?)(?=\n#|$)/i);
        result.hasSection = !!parentsSection;

        console.debug('[Family Tree] Parents section match:', parentsSection?.[0].substring(0, 50) + '...');

        if (!parentsSection || !parentsSection[2]) return result;

        // Поиск с учетом разных вариантов написания
        const motherLine = parentsSection[2].match(/^[-\*]\s*Мать\s*:\s*\[\[(.*?)\]\]/im);
        const fatherLine = parentsSection[2].match(/^[-\*]\s*Отец\s*:\s*\[\[(.*?)\]\]/im);

        console.debug('[Family Tree] Mother line:', motherLine?.[1], 'Father line:', fatherLine?.[1]);

        result.mother = motherLine ? motherLine[1].split('|')[0].trim() : null;
        result.father = fatherLine ? fatherLine[1].split('|')[0].trim() : null;

    } catch (err) {
        console.error('[Family Tree] Error parsing parents:', err);
    }
    
    return result;
  }

  // Построение двусторонних связей между родителями и детьми
  private buildFamilyLinks() {
    const peopleMap = new Map(this.people.map(p => [p.id, p]));
    
    console.log("Building family links...");
    this.people.forEach(person => {
        console.log(`Processing: ${person.id} 
            Mother: ${person.mother} 
            Father: ${person.father}`);
            
        [person.mother, person.father].forEach(parentId => {
            if (parentId && peopleMap.has(parentId)) {
                const parent = peopleMap.get(parentId)!;
                console.log(`Adding child ${person.id} to parent ${parentId}`);
                parent.children.push(person.id);
            }
        });
    });
    
    console.log("Final children lists:");
    this.people.forEach(p => {
        console.log(`${p.id}: ${p.children.join(", ")}`);
    });
  }
}

// Класс для отображения древовидной структуры
class FamilyTreeView extends ItemView {
  private plugin: FamilyTreePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: FamilyTreePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  // Методы интерфейса Obsidian
  getViewType() { return 'family-tree'; }
  getDisplayText() { return 'Family Tree'; }
  getIcon() { return 'users'; }

  async onOpen() {
    await this.drawTree();
  }

  // Поиск корневого элемента (человека без родителей)
  private findRootPerson(people: Person[]): Person | null {
    // Ищем человека без детей (самого младшего в дереве)
    const candidates = people.filter(p => p.children.length === 0);
    
    // Если несколько кандидатов, выбираем первого с указанными родителями
    return candidates.find(p => p.mother || p.father) 
        || candidates[0] 
        || people[0] 
        || null;
  }

  private async drawTree() {
    const container = this.containerEl.children[1];
    container.empty();
    container.style.overflow = 'auto';

    try {
        const people = await this.plugin.loadPeople();
        // Проверка наличия данных
        if (!people || people.length === 0) {
            console.debug('[Family Tree] No people data available');
            return;
        }

        // Определение пола с проверкой
        people.forEach(person => {
            if (!person.gender) {
                person.gender = this.determineGender(person, people);
            }
        });

        const rootPerson = this.findRootPerson(people);
        if (!rootPerson) {
            console.debug('[Family Tree] Root person not found');
            return;
        }

        const rootNode = this.buildHierarchy(rootPerson, people);
        // Проверка иерархии
        if (!rootNode) {
            console.error('[Family Tree] Failed to build hierarchy');
            return;
        }

        const treeLayout = d3.tree<d3.HierarchyNode<Person>>()
            .nodeSize([120, 200])
            .separation((a, b) => 1.5);

        treeLayout(rootNode);

        // Инверсия координат с проверкой
        rootNode.each(d => {
            d.y = -d.y + (container.clientHeight - 200);
            if (isNaN(d.x)) d.x = 0;
            if (isNaN(d.y)) d.y = 0;
        });

        const svg = d3.select(container)
            .append("svg")
            .attr("width", "100%")
            .attr("height", "100%")
            .call(d3.zoom().on("zoom", (event) => {
                g.attr("transform", event.transform);
            }));

        const g = svg.append("g")
            .attr("transform", `translate(100, 50)`);

        // Проверка наличия связей
        const links = rootNode.links();
        if (!links || links.length === 0) {
            console.debug('[Family Tree] No links to draw');
        } else {
            g.selectAll(".link")
                .data(links)
                .enter().append("path")
                .attr("class", "link")
                .attr("d", d3.linkVertical()
                    .x(d => d.x)
                    .y(d => d.y))
                .style("stroke", "#666")
                .style("fill", "none");
        }

        // Обработка узлов с проверкой
        const descendants = rootNode.descendants();
        if (!descendants || descendants.length === 0) {
            console.debug('[Family Tree] No nodes to display');
            return;
        }

        const nodes = g.selectAll(".node")
            .data(descendants)
            .enter().append("g")
            .attr("class", "node")
            .attr("transform", d => `translate(${d.x},${d.y})`)
            .style("cursor", "pointer")
            .on("click", (_, d) => this.openNote(d.data.id));

        nodes.append("circle")
            .attr("r", 14)
            .style("fill", d => 
                d.data.gender === 'female' ? "#ff79c6" : "#8be9fd"
            )
            .style("stroke", "#444")
            .style("stroke-width", 2);

        nodes.append("text")
            .attr("dy", "0.31em")
            .attr("dx", 20)
            .style("text-anchor", "start")
            .style("font-size", "12px")
            .style("fill", "#2f2f2f")
            .style("paint-order", "stroke")
            .style("stroke", "#ffffff")
            .style("stroke-width", "1px")
            .text(d => d.data.name || 'Unnamed'); // Запас для отсутствующих имен

        // Автомасштабирование с проверкой
        const textDimensions = descendants.map(d => ({
            x: d.x,
            y: d.y,
            width: (d.data.name?.length || 0) * 7
        }));

        const bounds = {
            minX: Math.min(...textDimensions.map(d => d.x - 20)),
            maxX: Math.max(...textDimensions.map(d => d.x + d.width + 40)),
            minY: Math.min(...textDimensions.map(d => d.y - 50)),
            maxY: Math.max(...textDimensions.map(d => d.y + 50))
        };

        if (isFinite(bounds.minX) && isFinite(bounds.maxX) && 
            isFinite(bounds.minY) && isFinite(bounds.maxY)) {
            svg.attr("viewBox", [
                bounds.minX,
                bounds.minY,
                bounds.maxX - bounds.minX,
                bounds.maxY - bounds.minY
            ].join(" "));
        } else {
            console.error('[Family Tree] Invalid viewBox bounds');
        }

    } catch (err) {
        console.error('[Family Tree] Drawing error:', err);
    }
  }

  // Обновленный метод buildHierarchy с проверками
  private buildHierarchy(person: Person, allPeople: Person[]): d3.HierarchyNode<Person> {
    const peopleMap = new Map(allPeople.map(p => [p.id, p]));
    
    const buildNode = (current: Person): any => {
        const parents = [];
        if (current.mother && peopleMap.has(current.mother)) {
            parents.push(peopleMap.get(current.mother));
        }
        if (current.father && peopleMap.has(current.father)) {
            parents.push(peopleMap.get(current.father));
        }
        return {
            ...current,
            children: parents.filter(p => p !== undefined) // Фильтрация undefined
        };
    };

    const rootData = buildNode(person);
    return d3.hierarchy(rootData, d => d.children);
  }

  private determineGender(person: Person, allPeople: Person[]): 'male' | 'female' {
    // Точное определение по участию в родительских связях
    const isMother = allPeople.some(p => p.mother === person.id);
    const isFather = allPeople.some(p => p.father === person.id);
    
    if (isMother && isFather) return person.gender || 'female'; // Если оба, используем резерв
    if (isMother) return 'female';
    if (isFather) return 'male';
    
    // Резервные правила для русского языка
    const nameLower = person.name.toLowerCase();
    return nameLower.endsWith('а') || nameLower.endsWith('я') ? 'female' : 'male';
  }

  // Открытие связанной заметки при клике
  private async openNote(id: string) {
    const file = this.app.vault.getAbstractFileByPath(`${id}.md`);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }
  }
}