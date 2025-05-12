from pathlib import Path
import re
from collections import deque, defaultdict
from typing import Dict, Optional, Set
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.font_manager import FontProperties
import numpy as np
from itertools import chain

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
    def __init__(self,
                gen_spacing=0.1,
                node_width=0.1,
                horizontal_padding=0.05,
                horizontal_margin=0.1):
        self.gen_spacing = gen_spacing # вертикальное расстояние между поколениями
        self.node_width = node_width # ширину узла древа (прямоугольника)
        self.horizontal_padding = horizontal_padding # отступ между узлами в одной группе
        self.horizontal_margin = horizontal_margin # отступ между узлами в разных группах
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

    def _calculate_positions(self):
        pos = {}
        generation_map = defaultdict(list)
        
        print(self.nodes)
        # Группировка по поколениям
        for node in self.nodes.values():
            if node.generation >= 0:
                generation_map[node.generation].append(node)

        print(generation_map)
        max_gen = max(generation_map.keys(), default=0)

        for gen in sorted(generation_map.keys(), reverse=True):
            y = (max_gen - gen) * self.gen_spacing
            print(f"{gen}:{y}")
            # Распределение узлов по X
            x_start = 0
            for node in generation_map[gen]:
                x_start += self.node_width# + self.horizontal_padding
                pos[node.id] = (x_start, y)
              
        return pos

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

    def _draw_node(self, ax, x, y, node):
        text = f"{node.name}\nGen {node.generation}"
        
        ax.annotate(
            text, 
            (x, y),
            ha='center', 
            va='center',
            fontsize=8,
            color='#333',
            bbox={
                'boxstyle': 'round,pad=0.3',
                'facecolor': 'white',
                'edgecolor': '#333',
                'linewidth': 1
            }
        )


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
