// @verify-changed-triggers: ../FileTabType.svelte, ../DiffTabType.svelte, ../ActivityChangesTabType.svelte,
//   ../LocalChangesTabType.svelte, ../ChangesTabType.svelte, ../NoteTabType.svelte, ../AgentTabType.svelte,
//   ../BrowserTabType.svelte, ../TerminalTabType.svelte, ../NoteViewSettingsDropdown.svelte,
//   ../AgentViewSettingsDropdown.svelte

import { readFileSync } from 'fs';
import { join } from 'path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAppStore, store as appStore } from '$store/renderer/store';
import type { ReduxStoreContext } from '$store/renderer/types';
import {
  setAgentFontStyle,
  setNoteFontStyle,
  setSpellcheckEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  selectAgentFontStyle,
  selectNoteFontStyle,
  selectSpellcheckEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { setNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { selectNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
import PanelViewSettingsHarness from './mocks/PanelViewSettingsHarness.svelte';

const tabTypesDirectory = join(process.cwd(), 'src/features/layout/tab-types');

function source(fileName: string): string {
  return readFileSync(join(tabTypesDirectory, fileName), 'utf8');
}

describe('panel header view settings consolidation', () => {
  it.each([
    'FileTabType.svelte',
    'DiffTabType.svelte',
    'ActivityChangesTabType.svelte',
    'LocalChangesTabType.svelte',
    'ChangesTabType.svelte',
  ])('uses the shared view settings menu in %s', (fileName) => {
    const contents = source(fileName);
    expect(contents).toContain('ViewSettingsDropdown');
    expect(contents).toContain('embedded');
    expect(contents).toContain('registerActions({ display:');
    expect(contents).not.toContain('headerToggleActiveClass');
  });

  it.each(['NoteTabType.svelte', 'AgentTabType.svelte'])(
    'uses a content-specific view settings menu in %s',
    (fileName) => {
      const contents = source(fileName);
      expect(contents).toMatch(/(?:Note|Agent)ViewSettingsDropdown/);
      expect(contents).toContain('embedded');
      expect(contents).toMatch(/display:\s+\w+DisplayActions/);
    },
  );

  it.each(['BrowserTabType.svelte', 'TerminalTabType.svelte'])(
    'does not add an empty settings menu to %s',
    (fileName) => {
      expect(source(fileName)).not.toContain('ViewSettingsDropdown');
    },
  );

  describe('embedded appearance interactions', () => {
    let storeContext: ReduxStoreContext;

    beforeEach(() => {
      storeContext = initAppStore(appStore);
      appStore.dispatch(setNoteFontStyle('sans'));
      appStore.dispatch(setAgentFontStyle('sans'));
      appStore.dispatch(setSpellcheckEnabled(true));
      appStore.dispatch(setNoteViewMode('view-settings', 'note-1', 'editor'));
    });

    afterEach(() => {
      cleanup();
      storeContext.dispose();
      vi.restoreAllMocks();
    });

    async function openAppearance(kind: 'note' | 'agent') {
      render(PanelViewSettingsHarness, {
        props: { kind },
        context: new Map([['redux-store-context', storeContext]]),
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Panel appearance' }));
      return screen.findByRole('menu', { name: 'Panel appearance' });
    }

    it.each(['note', 'agent'] as const)(
      'changes only the %s font preference and keeps the nested menu open',
      async (kind) => {
        const root = await openAppearance(kind);
        const dispatch = vi.spyOn(appStore, 'dispatch');
        await fireEvent.keyDown(within(root).getByRole('menuitem', { name: /Font style/i }), {
          key: 'ArrowRight',
        });
        const submenu = await screen.findByRole('menu', { name: /^Font style$/i });
        const mono = within(submenu).getByRole('menuitemradio', { name: 'Mono', exact: true });
        await fireEvent.click(mono);

        await waitFor(() => expect(mono.getAttribute('aria-checked')).toBe('true'));
        expect(
          within(submenu)
            .getByRole('menuitemradio', { name: 'Sans-serif' })
            .getAttribute('aria-checked'),
        ).toBe('false');
        const actionType = kind === 'note' ? setNoteFontStyle.type : setAgentFontStyle.type;
        expect(dispatch.mock.calls.filter(([action]) => action.type === actionType)).toEqual([
          [{ type: actionType, payload: ['monospace'] }],
        ]);
        expect(selectNoteFontStyle.select(appStore.state)).toBe(
          kind === 'note' ? 'monospace' : 'sans',
        );
        expect(selectAgentFontStyle.select(appStore.state)).toBe(
          kind === 'agent' ? 'monospace' : 'sans',
        );
        expect(screen.getByRole('menu', { name: 'Panel appearance' })).toBe(root);
        expect(screen.getByRole('menu', { name: /^Font style$/i })).toBe(submenu);
      },
    );

    it('disables spellcheck only for preview and restores it when the note becomes editable', async () => {
      const root = await openAppearance('note');
      const viewTrigger = within(root).getByRole('menuitem', { name: /^Note view/ });
      await fireEvent.keyDown(viewTrigger, { key: 'ArrowRight' });
      const submenu = await screen.findByRole('menu', { name: 'Note view', exact: true });
      const preview = within(submenu).getByRole('menuitemradio', { name: 'Rendered preview' });
      await fireEvent.click(preview);
      expect(selectNoteViewMode.select(appStore.state, 'view-settings', 'note-1')).toBe('preview');
      expect(selectNoteViewMode.select(appStore.state, 'view-settings', 'other-note')).toBe(
        'editor',
      );
      await fireEvent.keyDown(preview, { key: 'Escape' });
      await waitFor(() =>
        expect(screen.queryByRole('menu', { name: 'Note view', exact: true })).toBeNull(),
      );

      const spellcheck = within(root).getByRole('menuitemcheckbox', {
        name: 'Spellcheck',
        exact: true,
      });
      await waitFor(() => expect(spellcheck.getAttribute('aria-disabled')).toBe('true'));
      await fireEvent.click(spellcheck);
      expect(selectSpellcheckEnabled.select(appStore.state)).toBe(true);

      await fireEvent.keyDown(viewTrigger, { key: 'ArrowRight' });
      const editableMenu = await screen.findByRole('menu', { name: 'Note view', exact: true });
      const raw = within(editableMenu).getByRole('menuitemradio', { name: /^Raw markdown$/i });
      await fireEvent.click(raw);
      expect(selectNoteViewMode.select(appStore.state, 'view-settings', 'note-1')).toBe('raw');
      await fireEvent.keyDown(raw, { key: 'Escape' });
      await waitFor(() =>
        expect(screen.queryByRole('menu', { name: 'Note view', exact: true })).toBeNull(),
      );
      await waitFor(() => expect(spellcheck.getAttribute('aria-disabled')).not.toBe('true'));
      await fireEvent.click(spellcheck);
      expect(selectSpellcheckEnabled.select(appStore.state)).toBe(false);
      await waitFor(() => expect(spellcheck.getAttribute('aria-checked')).toBe('false'));
      expect(await screen.findByRole('menu', { name: 'Panel appearance' })).toBe(root);
    });
  });
});
