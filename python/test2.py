from pathlib import Path
import re
from collections import deque, defaultdict
from typing import Dict, Optional, Set
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.font_manager import FontProperties
import numpy as np

class TreeNode:
    def __init__(self, person_id: str, name: str):
        self.id = person_id
        self.name = name
        self.mother: Optional[TreeNode] = None
        self.father: Optional[TreeNode] = None
        self.children: list[TreeNode] = []
        self.generation: int = -1  # -1 = не определено

    def __repr__(self):
        return f"{self.name} (Gen {self.generation})"

class FamilyTree:
    def __init__(self):
        self.nodes: Dict[str, TreeNode] = {}
    
    def add_node(self, node: TreeNode):
        self.nodes[node.id] = node
    
    def calculate_generations(self, base_generation: int = 1):
        generation_map = {}
        
        # Первый этап: обработка явных корней
        roots = [n for n in self.nodes.values() if not n.mother and not n.father]
        queue = deque((n, base_generation) for n in roots)
        
        while queue:
            node, gen = queue.popleft()
            if node.id in generation_map:
                if generation_map[node.id] >= gen:
                    continue
            generation_map[node.id] = gen
            
            # Обновляем родителей на основе детей
            for parent in filter(None, [node.mother, node.father]):
                if parent.id not in generation_map or generation_map[parent.id] < gen - 1:
                    queue.append((parent, gen - 1))
            
            # Обновляем детей
            for child in node.children:
                new_child_gen = gen + 1
                if child.id not in generation_map or generation_map[child.id] < new_child_gen:
                    queue.append((child, new_child_gen))

        # Второй этап: обработка оставшихся связей
        for _ in range(2):  # Двух проходов обычно достаточно
            for node in self.nodes.values():
                if node.id in generation_map:
                    continue
                    
                # Определяем поколение через родителей
                parent_gens = []
                for parent in [node.mother, node.father]:
                    if parent and parent.id in generation_map:
                        parent_gens.append(generation_map[parent.id])
                
                if parent_gens:
                    generation_map[node.id] = max(parent_gens) + 1
                    continue
                    
                # Определяем через детей
                child_gens = [generation_map[c.id] for c in node.children if c.id in generation_map]
                if child_gens:
                    generation_map[node.id] = min(child_gens) - 1

        # Сохраняем результаты
        for node in self.nodes.values():
            node.generation = generation_map.get(node.id, -1)

    def print_tree(self, node: TreeNode, level: int = 0, visited: Optional[Set[TreeNode]] = None):
        """Модифицированная печать с поколениями"""
        visited = visited or set()
        if node in visited:
            return
        
        visited.add(node)
        prefix = "│   " * (level-1) + "├── " if level > 0 else ""
        print(f"{prefix}{node.name} [Gen {node.generation}]")
        
        # Сортируем детей по поколениям
        for child in sorted(node.children, key=lambda x: x.generation, reverse=True):
            self.print_tree(child, level + 1, visited)

    def _calculate_positions(self):
        """Алгоритм позиционирования с резервной стратегией"""
        
        pos = {}
        generation_map = defaultdict(list)
        for node in self.nodes.values():
            if node.generation != -1:
                generation_map[node.generation].append(node)
        
        # Определение параметров сетки
        max_gen = max(generation_map.keys(), default=1)
        vertical_spacing = 1.0 / max(1, max_gen)
        horizontal_spacing = 1.0
        
        # Резервные позиции для узлов без родителей
        reserve_x = 0
        reserve_y = 0.5
        
        # Обработка каждого поколения
        for gen in sorted(generation_map.keys()):
            nodes = generation_map[gen]
            y = 1.0 - gen * vertical_spacing
            
            # Группировка по наличию родителей
            has_parents = []
            no_parents = []
            
            for node in nodes:
                if node.mother or node.father:
                    has_parents.append(node)
                else:
                    no_parents.append(node)
            
            # Распределение узлов с родителями
            if has_parents:
                parent_groups = self._group_parents(has_parents, pos)
                x_start = 0.1
                for group in parent_groups:
                    if group["parents"]:
                        try:
                            parent_x = np.nanmean([pos[p.id][0] for p in group["parents"]])
                        except KeyError:
                            parent_x = x_start
                    else:
                        parent_x = x_start
                    
                    num_children = len(group["children"])
                    child_width = min(0.8, horizontal_spacing / num_children)
                    
                    for i, child in enumerate(group["children"]):
                        x = parent_x - (num_children * child_width)/2 + i * child_width
                        pos[child.id] = (x, y)
                        x_start = x + child_width
            
            # Распределение узлов без родителей
            if no_parents:
                num_orphans = len(no_parents)
                for i, node in enumerate(no_parents):
                    x = reserve_x + i * 0.1
                    pos[node.id] = (x, reserve_y)
                reserve_x += num_orphans * 0.1 + 0.2
        
        # Заполнение пропущенных позиций
        for node in self.nodes.values():
            if node.id not in pos:
                pos[node.id] = (reserve_x, reserve_y)
                reserve_x += 0.2
        
        return pos

    def _draw_node(self, ax, x, y, node):
        """Отрисовка узла с проверкой перекрытий"""
        # Проверяем перекрытие с существующими узлами
        for artist in ax.get_children():
            if isinstance(artist, patches.FancyBboxPatch):
                bbox = artist.get_bbox()
                if (x > bbox.x0 - 0.1 and x < bbox.x1 + 0.1 and
                    y > bbox.y0 - 0.1 and y < bbox.y1 + 0.1):
                    # Сдвигаем позицию при обнаружении перекрытия
                    x += 0.15
                    y -= 0.05
        
        # Отрисовка узла
        text = f"{node.name}\nGen {node.generation}"
        box = patches.FancyBboxPatch(
            (x - 0.1, y - 0.05),
            0.2, 0.1,
            boxstyle="round,pad=0.02",
            edgecolor="#333",
            facecolor="#fff",
            lw=1
        )
        ax.add_patch(box)
        ax.text(x, y, text, ha='center', va='center', 
               fontsize=8, color='#333')

    def visualize_with_matplotlib(self):
        """Финальная версия визуализации"""
        plt.figure(figsize=(20, 15))
        ax = plt.gca()
        
        pos = self._calculate_positions()
        
        # Фильтрация и валидация позиций
        valid_pos = {}
        for node_id, (x, y) in pos.items():
            if np.isfinite(x) and np.isfinite(y):
                valid_pos[node_id] = (x, y)
            else:
                print(f"Filtered invalid position for node {node_id}")
        
        # Автомасштабирование с резервными значениями
        all_x = [x for x, _ in valid_pos.values()] or [0.5]
        all_y = [y for _, y in valid_pos.values()] or [0.5]
        
        x_min, x_max = min(all_x), max(all_x)
        y_min, y_max = min(all_y), max(all_y)
        
        x_range = x_max - x_min if x_max > x_min else 1.0
        y_range = y_max - y_min if y_max > y_min else 1.0
        
        plt.xlim(x_min - 0.1*x_range, x_max + 0.1*x_range)
        plt.ylim(y_min - 0.1*y_range, y_max + 0.1*y_range)
        
        # Отрисовка связей
        for node in self.nodes.values():
            if node.id not in valid_pos:
                continue
            
            try:
                if node.mother and node.mother.id in valid_pos:
                    self._draw_connection(ax, valid_pos[node.mother.id], valid_pos[node.id], 'mother')
                if node.father and node.father.id in valid_pos:
                    self._draw_connection(ax, valid_pos[node.father.id], valid_pos[node.id], 'father')
            except KeyError as e:
                print(f"Connection error: {e}")
        
        # Отрисовка узлов
        for node_id, (x, y) in valid_pos.items():
            self._draw_node(ax, x, y, self.nodes[node_id])
        
        plt.axis('off')
        plt.tight_layout()
        plt.show()

    def _group_parents(self, nodes, pos):
        """Группирует детей по общим родителям с защитой от пустых родителей"""
        parent_map = defaultdict(list)
        for node in nodes:
            parents = tuple(sorted([p.id for p in [node.mother, node.father] if p]))
            parent_map[parents].append(node)
        
        groups = []
        for parents_ids, children in parent_map.items():
            parents = [self.nodes[pid] for pid in parents_ids if pid in self.nodes]
            groups.append({
                "parents": parents,
                "children": children
            })
        
        # Безопасная сортировка с обработкой отсутствующих родителей
        groups.sort(key=lambda g: np.mean([pos[p.id][0] for p in g["parents"]]) 
            if g["parents"] else float('inf'))  # Группы без родителей в конец
        
        return groups

    def _draw_connection(self, ax, start_pos, end_pos, connection_type):
        """Рисуем соединение с обработкой ошибок"""
        try:
            # Проверяем конечность всех координат
            if not (np.isfinite(start_pos).all() and np.isfinite(end_pos).all()):
                return
            
            # Проверяем минимальное расстояние между точками
            if np.linalg.norm(np.array(start_pos) - np.array(end_pos)) < 0.01:
                return

            if np.allclose(start_pos, end_pos):
                return  # Пропускаем соединения с одинаковыми координатами
            
            color = '#FF6B6B' if connection_type == 'mother' else '#4ECDC4'
            arrow = patches.FancyArrowPatch(
                start_pos,
                end_pos,
                arrowstyle='->',
                color=color,
                mutation_scale=20,
                linewidth=1.5,
                connectionstyle="arc3,rad=0.25"
            )
            ax.add_patch(arrow)
        except Exception as e:
            print(f"Error drawing connection {start_pos}->{end_pos}: {str(e)}")

def parse_md_files(directory: str) -> FamilyTree:
    tree = FamilyTree()
    
    # Создание узлов
    for md_file in Path(directory).glob("*.md"):
        person_id = md_file.stem
        content = md_file.read_text(encoding='utf-8')
        
        # Парсинг родителей
        mother_id = father_id = None
        parents_section = re.search(r'# Родители\n(.*?)(?=\n#|\Z)', content, re.DOTALL)
        if parents_section:
            parents_content = parents_section.group(1)
            mother_match = re.search(r'- Мать:\s*\[\[(.*?)\]\]', parents_content)
            father_match = re.search(r'- Отец:\s*\[\[(.*?)\]\]', parents_content)
            
            mother_id = mother_match.group(1).split('|')[0].strip() if mother_match else None
            father_id = father_match.group(1).split('|')[0].strip() if father_match else None

        node = TreeNode(person_id, person_id)
        node.mother = mother_id  # Временно храним ID
        node.father = father_id
        tree.add_node(node)
    
    # Установка связей
    for node in tree.nodes.values():
        if isinstance(node.mother, str):
            node.mother = tree.nodes.get(node.mother)
        if isinstance(node.father, str):
            node.father = tree.nodes.get(node.father)
        
        if node.mother and isinstance(node.mother, TreeNode):
            node.mother.children.append(node)
        if node.father and isinstance(node.father, TreeNode):
            node.father.children.append(node)
    
    # Расчет поколений
    tree.calculate_generations()
    return tree

# Пример использования
if __name__ == "__main__":
    family_tree = parse_md_files("/home/arseniy/python-dev/family_tree/family")
    family_tree.visualize_with_matplotlib()
