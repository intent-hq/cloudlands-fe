import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/experimental-ct-svelte';
import { recordCdpLifecycle } from '../../../test/ct-cdp-lifecycle-recorder';
import DeferredThemeRealSurfaceHost from './DeferredThemeRealSurfaceHost.svelte';

test.setTimeout(60_000);
recordCdpLifecycle(test);
test.afterEach(async ({ page }) => {
  await page.locator('#root').evaluate(async (root) => {
    if (root.childElementCount > 0) await window.playwrightUnmount(root);
  });
});

const artifactDirectory =
  process.env.FOUNDATION_ARTIFACT_DIR ?? path.join('test-results', 'deferred-theme-real-surfaces');

const preferences = [
  { id: 'light', preference: 'light', resolvedTheme: 'light', colorScheme: 'light' },
  { id: 'dark', preference: 'dark', resolvedTheme: 'dark', colorScheme: 'dark' },
  { id: 'system-light', preference: 'system', resolvedTheme: 'light', colorScheme: 'light' },
  { id: 'system-dark', preference: 'system', resolvedTheme: 'dark', colorScheme: 'dark' },
] as const;
const widths = [640, 1280] as const;
const scales = [1, 2] as const;

fs.mkdirSync(artifactDirectory, { recursive: true });

for (const mode of preferences) {
  for (const width of widths) {
    for (const zoom of scales) {
      const scale = zoom === 1 ? '100' : '200';
      const id = `${mode.id}-${width}-${scale}`;

      test(`real deferred theme surfaces ${id}`, async ({ mount, page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: mode.colorScheme, reducedMotion: 'reduce' });
        const component = await mount(DeferredThemeRealSurfaceHost, {
          props: {
            preference: mode.preference,
            resolvedTheme: mode.resolvedTheme,
            viewportWidth: width,
            zoom,
          },
        });

        const requiredSurfaces = [
          'regular-chat',
          'chief',
          'sidebar',
          'model-picker',
          'avatar',
          'menu',
          'note',
          'empty-state',
        ];
        for (const surface of requiredSurfaces) {
          await expect(component.locator(`[data-real-surface="${surface}"]`)).toBeVisible();
        }
        await expect(
          component.getByTestId('chat-transcript-scroll-viewport').first(),
        ).toBeVisible();
        await expect(component.getByTestId('composer-prompt-layer').first()).toBeVisible();
        await expect(component.locator('[data-panel-empty-state]')).toBeVisible();
        await expect(component.locator('[data-note-content-surface]')).toBeVisible();
        await expect(
          component.locator('[data-real-surface="avatar"] [data-agent-avatar-surface]'),
        ).toBeVisible();
        await expect(component.getByText('Open surface')).toBeVisible();

        const modelButton = component.locator('[data-real-surface="model-picker"] button').first();
        const restingBorder = await modelButton.evaluate(
          (element) => getComputedStyle(element).borderColor,
        );
        expect(restingBorder).not.toBe('rgba(0, 0, 0, 0)');

        await page.screenshot({
          path: path.join(artifactDirectory, `${id}-surfaces.png`),
          fullPage: true,
          animations: 'disabled',
        });
        await modelButton.focus();
        const focusStyle = await modelButton.evaluate((element) => {
          const style = getComputedStyle(element);
          return { borderColor: style.borderColor, boxShadow: style.boxShadow };
        });
        expect(focusStyle.boxShadow).not.toBe('none');
        await page.screenshot({
          path: path.join(artifactDirectory, `${id}-model-focus.png`),
          fullPage: true,
          animations: 'disabled',
        });

        const evidence = await component.evaluate((host) => {
          const style = (selector: string) => {
            const element = host.querySelector(selector);
            if (!element) return null;
            const computed = getComputedStyle(element);
            return {
              backgroundColor: computed.backgroundColor,
              color: computed.color,
              borderColor: computed.borderColor,
            };
          };
          return {
            regularChat: style('[data-real-surface="regular-chat"]'),
            chiefTranscript: style(
              '[data-real-surface="chief"] [data-testid="chat-transcript-inner"]',
            ),
            chiefComposer: style(
              '[data-real-surface="chief"] [data-testid="composer-prompt-layer"]',
            ),
            sidebar: style('[data-sidebar-card-surface]'),
            modelPicker: style('[data-real-surface="model-picker"] button'),
            avatar: style('[data-real-surface="avatar"] [data-agent-avatar-surface]'),
            note: style('[data-note-content-surface]'),
            emptyState: style('[data-panel-empty-state]'),
          };
        });
        const expectedCanvas =
          mode.resolvedTheme === 'dark' ? 'rgb(26, 26, 26)' : 'rgb(255, 255, 255)';
        const expectedSidebar =
          mode.resolvedTheme === 'dark' ? 'rgb(38, 38, 38)' : 'rgb(245, 245, 245)';
        expect(evidence.regularChat?.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(evidence.chiefTranscript?.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(evidence.chiefComposer?.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(evidence.sidebar?.backgroundColor).toBe(expectedSidebar);
        expect(evidence.note?.backgroundColor).toBe(expectedCanvas);
        expect(evidence.emptyState?.backgroundColor).toBe(expectedSidebar);
        expect(evidence.avatar?.color).not.toBe(evidence.avatar?.backgroundColor);
        fs.writeFileSync(
          path.join(artifactDirectory, `${id}.json`),
          JSON.stringify({ id, ...mode, width, zoom, focusStyle, evidence }, null, 2),
        );
      });
    }
  }
}
