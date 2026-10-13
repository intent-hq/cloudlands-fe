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
import {
  createEditorIconResolver,
  createEditorFallbackIconResolver,
} from '$shared/editors/editor-icon-resolver';

export type EditorIconComponent = typeof VSCodeIcon;

const resolveCanonicalEditorIcon = createEditorIconResolver<EditorIconComponent>({
  cursor: CursorCodeIcon,
  ghostty: GhosttyIcon,
  terminal: TerminalIcon,
  warp: WarpIcon,
  vscode: VSCodeIcon,
  jetbrains: JetBrainsIcon,
  xcode: XcodeIcon,
});

export function resolveEditorIcon(
  editor: Pick<EditorDefinition, 'id' | 'handlerType'>,
): EditorIconComponent | null {
  return resolveCanonicalEditorIcon(editor);
}

const resolveCanonicalFallbackIcon = createEditorFallbackIconResolver({
  code: faCode,
  folder: faFolder,
  terminal: faTerminal,
});

export function resolveEditorFallbackIcon(category?: EditorCategory): IconDefinition {
  return resolveCanonicalFallbackIcon(category);
}
