const DEFAULT_MAX_SELECTED_TEXT_LENGTH = 500;

type SelectableShadowRoot = ShadowRoot & { getSelection?: () => Selection | null };

interface SelectedTextOptions {
  extraRoots?: ParentNode[];
  maxLength?: number;
}

function normalizeSelectedText(text: string, maxLength: number): string | null {
  const normalized = text.replace(/\u00a0/g, ' ').replace(/[\t\r\n]+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function containsComposedNode(root: ParentNode, node: Node | null): boolean {
  if (!node) return false;

  if (root instanceof ShadowRoot) {
    return node.getRootNode() === root;
  }

  const rootNode = root as Node;
  if (rootNode.contains(node)) return true;

  const nodeRoot = node.getRootNode();
  return nodeRoot instanceof ShadowRoot && rootNode.contains(nodeRoot.host);
}

function selectionIsContainedByRoot(selection: Selection, root: ParentNode): boolean {
  if (!containsComposedNode(root, selection.anchorNode)) return false;
  if (!containsComposedNode(root, selection.focusNode)) return false;

  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (!containsComposedNode(root, range.startContainer)) return false;
    if (!containsComposedNode(root, range.endContainer)) return false;
  }

  return true;
}

function getTextFromSelection(
  selection: Selection | null | undefined,
  roots: ParentNode[],
  maxLength: number,
): string | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  if (!roots.some((root) => selectionIsContainedByRoot(selection, root))) return null;
  return normalizeSelectedText(selection.toString(), maxLength);
}

export function getSelectedTextWithinSurface(
  surface: ParentNode | null | undefined,
  { extraRoots = [], maxLength = DEFAULT_MAX_SELECTED_TEXT_LENGTH }: SelectedTextOptions = {},
): string | null {
  const roots = [surface, ...extraRoots].filter((root): root is ParentNode => root != null);
  if (roots.length === 0 || typeof document === 'undefined') return null;

  const documentSelection = getTextFromSelection(document.getSelection?.(), roots, maxLength);
  if (documentSelection) return documentSelection;

  for (const root of roots) {
    if (root instanceof ShadowRoot) {
      const shadowSelection = getTextFromSelection(
        (root as SelectableShadowRoot).getSelection?.(),
        [root],
        maxLength,
      );
      if (shadowSelection) return shadowSelection;
    }
  }

  return null;
}