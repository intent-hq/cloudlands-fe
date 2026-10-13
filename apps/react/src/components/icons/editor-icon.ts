import type { IconDefinition } from '$lib/icons/icon-definition';
import { faCode, faFolder, faTerminal } from '$lib/icons/phosphor-icon-definitions';
import type { EditorCategory, EditorDefinition } from '$shared/editors/editor-registry';
import { CursorCodeIcon } from './cursor-code-icon';
import { GhosttyIcon } from './ghostty-icon';
import { JetBrainsIcon } from './jetbrains-icon';
import { TerminalIcon } from './terminal-icon';
import { VSCodeIcon } from './vscode-icon';
import { WarpIcon } from './warp-icon';
import { XcodeIcon } from './xcode-icon';
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
