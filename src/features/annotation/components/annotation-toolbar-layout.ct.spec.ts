import { expect, test } from '../../../test/ct-test';
import ToolbarPreview from './annotation-toolbar.preview.svelte';
import { writeFile } from 'node:fs/promises';

// Keep the primary controls usable at normal and narrow native work-area widths.
// Tool strips may scroll; voice, destination and sending controls must remain visible.
for (const theme of ['light', 'dark'] as const) {
  for (const width of [720, 480, 320]) {
    test(`horizontal toolbar ${theme} ${width} keeps voice and actions reachable`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 320 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.evaluate((value) => {
        document.documentElement.classList.toggle('dark', value === 'dark');
        document.documentElement.classList.toggle('light', value === 'light');
      }, theme);
      const evidence: unknown[] = [];
      const labels = {
        idle: 'Mic off',
        requesting: 'Starting microphone…',
        recording: 'Recording voice',
        transcribing: 'Transcribing…',
        error: 'Voice transcription failed. Retry.',
      };
      for (const voiceStatus of [
        'idle',
        'requesting',
        'recording',
        'transcribing',
        'error',
      ] as const) {
        const component = await mount(ToolbarPreview, { props: { voiceStatus, panelHeight: 320 } });
        const panel = component.getByRole('navigation', { name: 'Annotation tools' });
        const status = component.locator('.voice-status');
        await expect(status).toHaveText(labels[voiceStatus]);
        for (const name of ['Workspace', 'Take screenshot', 'Send to agent', 'Cancel']) {
          await expect(component.getByRole('button', { name, exact: true })).toBeInViewport({
            ratio: 1,
          });
        }
        await expect(component.locator('.voice-action')).toBeInViewport({ ratio: 1 });
        if (voiceStatus === 'recording') {
          await expect(
            component.getByRole('button', { name: 'Stop voice', exact: true }),
          ).toBeEnabled();
          await expect(component.getByRole('timer')).toHaveText('0:42');
          await expect(component.getByRole('timer')).toHaveAttribute('aria-live', 'off');
        }
        if (voiceStatus === 'requesting' || voiceStatus === 'transcribing') {
          await expect(component.locator('.voice-action')).toBeDisabled();
        }
        await expect(status).toHaveAttribute('aria-live', 'polite');
        const voice = await component.locator('.voice-section').boundingBox();
        const bounds = await panel.boundingBox();
        if (!bounds || !voice) throw new Error('Missing visible toolbar bounds');
        expect(voice.y).toBeGreaterThanOrEqual(bounds.y);
        expect(voice.y + voice.height).toBeLessThanOrEqual(bounds.y + bounds.height);
        const pin = component.getByRole('button', { name: 'Pin', exact: true });
        await pin.focus();
        await pin.press('Enter');
        await expect(pin).toHaveAttribute('aria-pressed', 'true');
        await expect(pin).toBeInViewport({ ratio: 1 });
        if (voiceStatus === 'idle') {
          await pin.press('ArrowRight');
          const mouse = component.getByRole('button', { name: 'Mouse', exact: true });
          await expect(mouse).toBeFocused();
          await expect(mouse).toHaveAttribute('aria-pressed', 'true');
          await mouse.press('ArrowLeft');
          await expect(pin).toBeFocused();
          await pin.press('Home');
          await expect(mouse).toBeFocused();
          await mouse.press('End');
          await expect(pin).toBeFocused();
          await expect(pin).toHaveAttribute('aria-pressed', 'true');
          await expect(component.getByRole('toolbar').locator('button[tabindex="0"]')).toHaveCount(
            1,
          );
        }
        const drawing = await component.locator('.drawing-cluster').boundingBox();
        const delivery = await component.locator('.delivery-cluster').boundingBox();
        if (!drawing || !delivery) throw new Error('Both toolbar groups must render');
        expect(drawing.x + drawing.width).toBeLessThan(delivery.x);
        const gapIntercepted = await page.evaluate(
          ({ x, y }) =>
            Boolean(document.elementFromPoint(x, y)?.closest('.annotation-toolbar-panel')),
          { x: (drawing.x + drawing.width + delivery.x) / 2, y: drawing.y + drawing.height / 2 },
        );
        expect(gapIntercepted, 'The space between groups must pass pointer input through').toBe(
          false,
        );
        const draw = component.getByRole('button', { name: 'Draw', exact: true });
        await draw.click();
        await expect(draw).toHaveAttribute('aria-pressed', 'true');
        await draw.evaluate((element) => (element as HTMLElement).blur());
        evidence.push({ voiceStatus, voice, bounds, drawing, delivery, gapIntercepted });
        await panel.screenshot({
          path: testInfo.outputPath(`${theme}-${width}-${voiceStatus}.png`),
        });
        await component.unmount();
      }
      await writeFile(
        testInfo.outputPath('horizontal-toolbar.json'),
        JSON.stringify({ synthetic: true, realMicrophone: false, width, theme, evidence }, null, 2),
      );
    });
  }
}

test('horizontal toolbar visual audit of transient states', async ({ mount, page }, testInfo) => {
  test.skip(process.env.COMPANION_AUDIT !== '1', 'Opt-in visual audit');
  test.setTimeout(120_000);
  const evidence: unknown[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [720, 480]) {
      await page.setViewportSize({ width, height: 360 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.evaluate((value) => {
        document.documentElement.classList.toggle('dark', value === 'dark');
        document.documentElement.classList.toggle('light', value === 'light');
      }, theme);
      for (const voiceStatus of [
        'idle',
        'requesting',
        'recording',
        'transcribing',
        'error',
      ] as const) {
        const component = await mount(ToolbarPreview, { props: { voiceStatus, panelHeight: 320 } });
        const panel = component.locator('.annotation-toolbar-panel');
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute('data-voice-state', voiceStatus);
        await panel.screenshot({
          path: testInfo.outputPath(`${theme}-${width}-${voiceStatus}.png`),
        });
        evidence.push({
          theme,
          width,
          voiceStatus,
          geometry: await panel.evaluate((element) => ({
            panel: element.getBoundingClientRect().toJSON(),
            controls: [...element.querySelectorAll<HTMLElement>('button')].map((el) => ({
              label: el.getAttribute('aria-label'),
              bounds: el.getBoundingClientRect().toJSON(),
              disabled: el.matches(':disabled'),
            })),
            voice: element.querySelector('.voice-copy')?.getBoundingClientRect().toJSON(),
          })),
        });
        await component.unmount();
      }
      const component = await mount(ToolbarPreview, {
        props: { captureError: true, panelHeight: 320 },
      });
      await component.getByRole('button', { name: 'Workspace', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toBeVisible();
      await expect(page.locator('.destination-notice [role="alert"]')).toBeVisible();
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(page.locator('.destination-notice')).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-error-popup.png`) });
      await page.keyboard.press('Escape');
      await expect(page.locator('.annotation-destination-popover')).toHaveCount(0);
      await component.unmount();
      const normal = await mount(ToolbarPreview, { props: { panelHeight: 320 } });
      const trigger = normal.getByRole('button', { name: 'Workspace', exact: true });
      await trigger.click();
      const workspace = page.getByRole('combobox', { name: 'Workspace', exact: true });
      await expect(workspace).toBeFocused();
      const before = await workspace.boundingBox();
      await workspace.fill('Website');
      await page.getByRole('option', { name: 'Website polish', exact: true }).click();
      await expect(workspace).toHaveValue('Website polish');
      expect(await workspace.boundingBox()).toEqual(before);
      const agent = page.getByRole('combobox', { name: 'Agent', exact: true });
      await agent.click();
      await agent.fill('Interface');
      await expect(
        page.getByRole('option', { name: 'Interface implementor', exact: true }),
      ).toBeVisible();
      await agent.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(page.locator('.annotation-destination-popover')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.annotation-destination-popover')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(workspace).toBeVisible();
      await expect(workspace).toBeFocused();
      await expect(page.getByRole('listbox')).toBeVisible();
      const outsideTarget = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return {
            tag: el?.tagName,
            className: el?.getAttribute('class'),
            pointerEvents: el ? getComputedStyle(el).pointerEvents : null,
          };
        },
        { x: width - 2, y: 2 },
      );
      // Click a real toolbar control outside the picker; transparent native margins
      // belong to the desktop and are not an application dismissal target.
      await normal.getByRole('button', { name: 'Mouse', exact: true }).click();
      await expect(page.getByRole('listbox')).toHaveCount(0);
      const outsideFirst = {
        lists: await page.getByRole('listbox').count(),
        expanded: await trigger.getAttribute('aria-expanded'),
      };
      await normal.getByRole('button', { name: 'Mouse', exact: true }).click();
      await expect(page.locator('.annotation-destination-popover')).toHaveCount(0);
      const outsideSecond = {
        lists: await page.getByRole('listbox').count(),
        expanded: await trigger.getAttribute('aria-expanded'),
      };
      await writeFile(
        testInfo.outputPath(`${theme}-${width}-outside-click.json`),
        JSON.stringify({ outsideTarget, outsideFirst, outsideSecond }, null, 2),
      );
      await expect(page.locator('.annotation-destination-popover')).toHaveCount(0);
      await normal.getByRole('button', { name: 'Pin', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(normal.getByRole('button', { name: 'Pin', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(normal.getByRole('button', { name: 'Pin', exact: true })).toBeInViewport();
      await normal.unmount();
      const busy = await mount(ToolbarPreview, { props: { pending: true, panelHeight: 320 } });
      await expect(busy.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
      await busy
        .locator('.annotation-toolbar-panel')
        .screenshot({ path: testInfo.outputPath(`${theme}-${width}-sending.png`) });
      await busy.unmount();
    }
  }
  await writeFile(testInfo.outputPath('toolbar-audit.json'), JSON.stringify(evidence, null, 2));
});
