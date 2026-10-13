import type { EditorCategory, EditorDefinition } from './editor-registry';

type EditorIcons<Component> = Record<
  'cursor' | 'ghostty' | 'terminal' | 'warp' | 'vscode' | 'jetbrains' | 'xcode',
  Component
>;

export function createEditorIconResolver<Component>(icons: EditorIcons<Component>) {
  const byId: Partial<Record<string, Component>> = {
    cursor: icons.cursor,
    ghostty: icons.ghostty,
    terminal: icons.terminal,
    warp: icons.warp,
  };
  const byHandler: Partial<Record<EditorDefinition['handlerType'], Component>> = {
    vscode: icons.vscode,
    jetbrains: icons.jetbrains,
    xcode: icons.xcode,
  };
  return (editor: Pick<EditorDefinition, 'id' | 'handlerType'>): Component | null =>
    byId[editor.id] ?? byHandler[editor.handlerType] ?? null;
}

export function createEditorFallbackIconResolver<Icon>(icons: {
  code: Icon;
  folder: Icon;
  terminal: Icon;
}) {
  return (category?: EditorCategory): Icon => {
    if (category === 'terminal') return icons.terminal;
    if (category === 'finder') return icons.folder;
    return icons.code;
  };
}
