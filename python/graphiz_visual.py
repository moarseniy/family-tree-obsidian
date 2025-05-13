from collections import deque, defaultdict
from typing import Optional, Dict, List
from pathlib import Path
import re
import graphviz

class TreeNode:
    def __init__(self, person_id: str, name: str):
        self.id = person_id
        self.name = name
        self.mother: Optional[TreeNode] = None
        self.father: Optional[TreeNode] = None
        self.children: List[TreeNode] = []
        self.generation: int = -1  # -1 = not defined

    def __repr__(self):
        return f"{self.name} (Gen {self.generation})"

class FamilyTree:
    def __init__(self):
        self.nodes: Dict[str, TreeNode] = {}

    def add_node(self, node: TreeNode):
        self.nodes[node.id] = node

    def calculate_generations(self, base_generation: int = 1):
        generation_map = {}
        roots = [n for n in self.nodes.values() if not n.mother and not n.father]
        queue = deque((n, base_generation) for n in roots)

        while queue:
            node, gen = queue.popleft()
            if node.id in generation_map and generation_map[node.id] >= gen:
                continue
            generation_map[node.id] = gen
            for parent in filter(None, [node.mother, node.father]):
                queue.append((parent, gen - 1))
            for child in node.children:
                queue.append((child, gen + 1))

        for _ in range(2):
            for node in self.nodes.values():
                if node.id in generation_map:
                    continue
                parent_gens = [generation_map[p.id] for p in (node.mother, node.father) if p and p.id in generation_map]
                if parent_gens:
                    generation_map[node.id] = max(parent_gens) + 1
                    continue
                child_gens = [generation_map[c.id] for c in node.children if c.id in generation_map]
                if child_gens:
                    generation_map[node.id] = min(child_gens) - 1

        for node in self.nodes.values():
            node.generation = generation_map.get(node.id, -1)

    def visualize_with_graphviz(self,
                                filename: str = 'family_tree',
                                format: str = 'png',
                                view: bool = True) -> graphviz.Digraph:
        """
        Visualize the family tree using Graphviz. Mothers framed in red, fathers in blue, others in black.
        Parents are placed adjacent.
        """
        dot = graphviz.Digraph(comment='FamilyTree', format=format)
        dot.attr('graph', rankdir='TB')  # Top to bottom layout

        # Determine roles: who is mother or father of someone
        is_mother = set()
        is_father = set()
        for node in self.nodes.values():
            for child in node.children:
                if child.mother is node:
                    is_mother.add(node.id)
                if child.father is node:
                    is_father.add(node.id)

        # Add all nodes with colored borders based on role
        for node in self.nodes.values():
            uid = node.id
            label = f"{node.name}\nGen {node.generation}"
            if uid in is_mother:
                border_color = 'red'
            elif uid in is_father:
                border_color = 'blue'
            else:
                border_color = 'black'
            dot.node(uid,
                     label,
                     color=border_color,
                     fontcolor='black',
                     style='rounded')

        # Group mother and father at same rank and add invisible edges for adjacency
        for child in self.nodes.values():
            m, f = child.mother, child.father
            if m and f:
                with dot.subgraph() as s:
                    s.attr(rank='same')
                    s.node(m.id)
                    s.node(f.id)
                dot.edge(m.id, f.id, style='invis')

        # Add edges parent -> child
        for node in self.nodes.values():
            for parent in (node.mother, node.father):
                if parent:
                    dot.edge(parent.id, node.id)

        dot.render(filename, view=view)
        return dot


def parse_md_files(directory: str) -> FamilyTree:
    """
    Parse Markdown files in `directory` to build a FamilyTree.
    """
    tree = FamilyTree()
    for md_file in Path(directory).glob("*.md"):
        person_id = md_file.stem
        content = md_file.read_text(encoding='utf-8')
        mother_id = father_id = None
        parents_section = re.search(r'# Родители\n(.*?)(?=\n#|\Z)', content, re.DOTALL)
        if parents_section:
            block = parents_section.group(1)
            m = re.search(r'- Мать:\s*\[\[(.*?)\]\]', block)
            f = re.search(r'- Отец:\s*\[\[(.*?)\]\]', block)
            mother_id = m.group(1).split('|')[0].strip() if m else None
            father_id = f.group(1).split('|')[0].strip() if f else None

        node = TreeNode(person_id, person_id)
        node.mother = mother_id
        node.father = father_id
        tree.add_node(node)

    for node in tree.nodes.values():
        if isinstance(node.mother, str):
            node.mother = tree.nodes.get(node.mother)
        if isinstance(node.father, str):
            node.father = tree.nodes.get(node.father)
        if node.mother:
            node.mother.children.append(node)
        if node.father:
            node.father.children.append(node)

    tree.calculate_generations()
    return tree

# Example usage
if __name__ == '__main__':
    directory = "/home/arseniy/Documents/Obsidian Vault/family" #sys.argv[1]
    tree = parse_md_files(directory)
    tree.visualize_with_graphviz(filename='my_family_tree')

