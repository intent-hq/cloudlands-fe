import { describe, expect, it } from 'vitest';
import { faCode, faFolder, faTerminal } from '@fortawesome/free-solid-svg-icons';
import { EDITOR_REGISTRY } from '$shared/editors/editor-registry';
import CursorCodeIcon from './CursorCodeIcon.svelte';
import GhosttyIcon from './GhosttyIcon.svelte';
import JetBrainsIcon from './JetBrainsIcon.svelte';
import TerminalIcon from './TerminalIcon.svelte';
import VSCodeIcon from './VSCodeIcon.svelte';
import WarpIcon from './WarpIcon.svelte';
import XcodeIcon from './XcodeIcon.svelte';
import { resolveEditorFallbackIcon, resolveEditorIcon } from './editor-icon';

describe('resolveEditorIcon', () => {
  it.each([
    ['cursor', CursorCodeIcon],
    ['ghostty', GhosttyIcon],
    ['terminal', TerminalIcon],
    ['warp', WarpIcon],
  ])('resolves the dedicated icon for the %s registry ID', (id, expected) => {
    expect(resolveEditorIcon({ id, handlerType: 'generic' })).toBe(expected);
  });

  it('resolves VS Code and Xcode from their handler families', () => {
    expect(resolveEditorIcon({ id: 'vscode', handlerType: 'vscode' })).toBe(VSCodeIcon);
    expect(resolveEditorIcon({ id: 'custom-vscode', handlerType: 'vscode' })).toBe(VSCodeIcon);
    expect(resolveEditorIcon({ id: 'xcode', handlerType: 'xcode' })).toBe(XcodeIcon);
  });

  it('resolves every JetBrains registry entry from the handler family', () => {
    const jetBrainsEditors = EDITOR_REGISTRY.filter(
      ({ handlerType }) => handlerType === 'jetbrains',
    );
    expect(jetBrainsEditors.length).toBeGreaterThan(1);
    for (const editor of jetBrainsEditors) {
      expect(resolveEditorIcon(editor)).toBe(JetBrainsIcon);
    }
  });

  it('returns null for an unknown generic editor', () => {
    expect(resolveEditorIcon({ id: 'unknown-editor', handlerType: 'generic' })).toBeNull();
  });
});

describe('resolveEditorFallbackIcon', () => {
  it.each([
    ['ide', faCode],
    ['terminal', faTerminal],
    ['finder', faFolder],
    [undefined, faCode],
  ] as const)('resolves the %s category fallback', (category, expected) => {
    expect(resolveEditorFallbackIcon(category)).toBe(expected);
  });
});
