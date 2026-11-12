import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import { SHORTCUT_DEFAULTS } from '$lib/utils/shortcut-bindings';
import { shortcutChord } from '../../../test/shortcut-chords';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import type { DockPlacementSnapshot } from '$shared/dock-placement';

for (const mode of ['notch', 'floating'] as const) {
  test(`${mode} composer survives an intermediate native height grant`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 760, height: 720 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
    const props = dockRailPreview.states[mode].props;
    const initial: DockPlacementSnapshot = {
      ...props.placement!,
      surface: { x: 100, y: 0, width: 420, height: 240 },
    };
    const component = await mount(Harness, {
      props: {
        shell: {
          ...props,
          placement: initial,
          workspaces: props.workspaces.slice(0, 2),
          controlledPlacement: true,
          manualResizeAcknowledgements: true,
        },
      },
    });
    const shell = component.getByTestId('dock-shell');
    await component.getByTestId('dock-drag-handle').hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    // The harness opens its conversation on mount; enter the overview before
    // observing the next conversation's native resize grants.
    await component.locator('[data-dock-conversation-back]').click();
    await expect(component.locator('.overview-row').first()).toBeVisible();
    const row = component.locator('.overview-row').first();
    const owner = await row
      .locator('button[data-workspace-id]')
      .first()
      .getAttribute('data-workspace-id');
    if (!owner) throw new Error('Missing workspace owner for the resize journey');
    // Main can reply to an earlier resize while a new growth request is pending.
    // Grant some room, then the full request while the height morph is still running.
    await page.evaluate(
      ({ snapshot, owner }) => {
        const host = document.querySelector('[data-preview-commands]')!;
        let ready = false;
        let granted = false;
        const ownerCurrent = () => {
          const h = (
            window as unknown as {
              __dockComposerE2E: {
                store: {
                  state: { dockConversation: { workspaceId: string | null; loading: boolean } };
                };
              };
            }
          ).__dockComposerE2E;
          const dock = h.store.state.dockConversation;
          const panel = document.querySelector<HTMLElement>(
            '[data-testid="dock-conversation-surface"]',
          );
          return (
            ready &&
            dock.workspaceId === owner &&
            !dock.loading &&
            panel?.dataset.workspaceId === owner
          );
        };
        const publish = (height: number, revision: number) => {
          const current = JSON.parse(host.getAttribute('data-preview-placement') ?? 'null');
          if (!ownerCurrent() || current?.revision !== revision - 1) return;
          window.dispatchEvent(
            new CustomEvent('dock-preview-placement', {
              detail: {
                placement: {
                  ...snapshot,
                  revision,
                  surface: { ...snapshot.surface, height },
                },
              },
            }),
          );
        };
        const maybeGrant = () => {
          if (granted || !ownerCurrent()) return;
          const requests = JSON.parse(host.getAttribute('data-preview-commands') ?? '[]');
          const last = requests.at(-1);
          if (last?.action !== 'resize' || last.height < 450 || last.revision !== snapshot.revision)
            return;
          granted = true;
          observer.disconnect();
          publish(300, 2);
          setTimeout(() => publish(452, 3), 50);
        };
        const observer = new MutationObserver(maybeGrant);
        observer.observe(host, { attributes: true, attributeFilter: ['data-preview-commands'] });
        window.addEventListener(
          'dock-height-target-ready',
          () => {
            ready = true;
            // The same pending request may predate Back; identical requests are deduplicated.
            maybeGrant();
          },
          { once: true },
        );
      },
      { snapshot: initial, owner },
    );
    await row.click();
    const surface = component.getByTestId('dock-conversation-surface');
    await expect(surface).toHaveCount(1);
    await expect(surface).toBeVisible();
    await expect(surface).toHaveAttribute('data-workspace-id', owner);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const h = (
            window as unknown as {
              __dockComposerE2E: {
                store: {
                  state: { dockConversation: { workspaceId: string | null; loading: boolean } };
                };
              };
            }
          ).__dockComposerE2E;
          const dock = h.store.state.dockConversation;
          return { workspaceId: dock.workspaceId, loading: dock.loading };
        }),
      )
      .toEqual({ workspaceId: owner, loading: false });
    await page.evaluate(() => window.dispatchEvent(new Event('dock-height-target-ready')));
    await expect(shell).toHaveAttribute('data-revision', '3');
    // The full native envelope alone is insufficient: its painted clip must reach it too.
    await expect
      .poll(() =>
        component.locator('.companion-content').evaluate((el) => getComputedStyle(el).clipPath),
      )
      .toMatch(/^inset\(0px(?: 0px){0,3} round/);
    const editor = component.locator('.tiptap-editor');
    const draft = 'Keep this draft.\nA second line.\nA third line.';
    await component.getByRole('button', { name: /^Capture the screen/ }).click();
    await expect(component.locator('[data-dock-media-attachments] .tile')).toHaveCount(1);
    await editor.focus();
    const isMac = await page.evaluate(() => /Mac/i.test(navigator.platform));
    for (const [index, line] of draft.split('\n').entries()) {
      if (index) await editor.press(shortcutChord(SHORTCUT_DEFAULTS['chat.new-line'], isMac).press);
      await page.keyboard.insertText(line);
    }
    await expect(editor).toContainText('A third line.');
    const savedDraft = await editor.innerText();
    const scroll = component.locator('.transcript-scroll');
    await scroll.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    const evidence: unknown[] = [];
    for (const height of [452, 340]) {
      await page.evaluate(
        ({ snapshot, height }) =>
          window.dispatchEvent(
            new CustomEvent('dock-preview-placement', {
              detail: {
                placement: {
                  ...snapshot,
                  revision: height === 452 ? 4 : 5,
                  surface: { ...snapshot.surface, height },
                },
              },
            }),
          ),
        { snapshot: initial, height },
      );
      await expect(editor).toBeFocused();
      expect(await editor.innerText()).toBe(savedDraft);
      await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
      const geometry = await component.evaluate((root) => {
        const box = (selector: string) =>
          root.querySelector(selector)!.getBoundingClientRect().toJSON();
        return {
          shell: box('.companion'),
          surface: box('.conversation-surface'),
          footer: box('.conversation-footer'),
          composer: box('[data-dock-conversation-composer]'),
          submit: box('[data-testid="composer-submit-button"]'),
        };
      });
      expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.shell.bottom);
      expect(geometry.footer.bottom).toBeLessThanOrEqual(geometry.surface.bottom);
      expect(geometry.submit.bottom).toBeLessThanOrEqual(geometry.shell.bottom);
      evidence.push({
        height,
        geometry,
        savedDraft,
        attachmentCount: 1,
        focusPreserved: true,
        scrollTop: 0,
      });
      await component.screenshot({ path: info.outputPath(`${mode}-${height}-after.png`) });
    }
    await component.locator('[data-dock-conversation-back]').click();
    await page.evaluate(() => {
      (
        window as unknown as { __dockComposerE2E: { reopen: () => void } }
      ).__dockComposerE2E.reopen();
    });
    await expect(editor).toContainText('A third line.');
    expect(await editor.innerText()).toBe(savedDraft);
    await expect(component.locator('[data-dock-media-attachments] .tile')).toHaveCount(1);
    await writeFile(info.outputPath(`${mode}-height.json`), JSON.stringify(evidence, null, 2));
  });
}
