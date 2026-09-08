import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faCode, faFolder, faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { EditorCategory, EditorDefinition } from '$shared/editors/editor-registry';
import CursorCodeIcon from './CursorCodeIcon.svelte';
import GhosttyIcon from './GhosttyIcon.svelte';
import JetBrainsIcon from './JetBrainsIcon.svelte';
import TerminalIcon from './TerminalIcon.svelte';
import VSCodeIcon from './VSCodeIcon.svelte';
import WarpIcon from './WarpIcon.svelte';
import XcodeIcon from './XcodeIcon.svelte';

export type EditorIconComponent = typeof VSCodeIcon;

const EDITOR_ICONS_BY_ID: Partial<Record<string, EditorIconComponent>> = {
  cursor: CursorCodeIcon,
  ghostty: GhosttyIcon,
  terminal: TerminalIcon,
  warp: WarpIcon,
};

const EDITOR_ICONS_BY_HANDLER: Partial<
  Record<EditorDefinition['handlerType'], EditorIconComponent>
> = {
  vscode: VSCodeIcon,
  jetbrains: JetBrainsIcon,
  xcode: XcodeIcon,
};

export function resolveEditorIcon(
  editor: Pick<EditorDefinition, 'id' | 'handlerType'>,
): EditorIconComponent | null {
  return EDITOR_ICONS_BY_ID[editor.id] ?? EDITOR_ICONS_BY_HANDLER[editor.handlerType] ?? null;
}

export function resolveEditorFallbackIcon(category?: EditorCategory): IconDefinition {
  if (category === 'terminal') return faTerminal;
  if (category === 'finder') return faFolder;
  return faCode;
}
