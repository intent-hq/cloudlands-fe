import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/experimental-ct-svelte';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);

async function settledScrollBaseline(component: Locator) {
  // Prompt visibility does not establish editor/draft readiness. The initial
  // editor layout and ResizeObserver delivery can still resize the composer.
  await expect(component.locator('.tiptap-editor')).toBeVisible();
  await expect(component.locator('.tiptap-editor')).toBeEditable();
  await component.evaluate(() => document.fonts.ready);
  let baseline: { prompts: DOMRect; composer: DOMRect } | undefined;
  await expect
    .poll(async () => {
      const sample = await component.evaluate(async (root) => {
        const prompts = root.querySelector('[data-testid="suggested-prompts-surface"]')!;
        const composer = root.querySelector('[data-testid="chat-composer-shell"]')!;
        const scroll = root.querySelector('[data-testid="chat-transcript-inner"]')!.parentElement!;
        const read = () => ({
          prompts: prompts.getBoundingClientRect().toJSON() as DOMRect,
          composer: composer.getBoundingClientRect().toJSON() as DOMRect,
          scroll: [scroll.scrollTop, scroll.scrollHeight, scroll.clientHeight],
        });
        const frames = [read()];
        for (let i = 0; i < 2; i++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          frames.push(read());
        }
        return {
          baseline: frames[2],
          stable: frames.every((frame) => JSON.stringify(frame) === JSON.stringify(frames[0])),
          atBottom: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 1,
        };
      });
      baseline = sample.baseline;
      return sample.stable && sample.atBottom;
    }, 'editor, composer, and bottom-aligned transcript must settle before the scroll baseline')
    .toBe(true);
  return baseline!;
}

for (const chief of [false, true]) {
  test(`follow-up prompts scroll with the ${chief ? 'Chief' : 'regular'} transcript`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 960, height: 720 });
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: {
        chief,
        theme: chief ? 'dark' : 'light',
        width: chief ? 420 : 900,
        followUp: chief ? 'discussion' : 'blocker',
      },
    });
    const prompts = component.getByTestId('suggested-prompts-surface');
    const composer = component.getByTestId('chat-composer-shell');
    const transcript = component.getByTestId('chat-transcript-inner');
    const scroll = transcript.locator('..');
    await expect(prompts).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThanOrEqual(1);

    const message = component.locator('[data-message-id="follow-up-assistant"]');
    const prose = message.locator('[data-assistant-prose]').last();
    const label = component.getByTestId('attention-request-label');
    const reason = component.getByTestId('attention-request-reason');
    const regenerate = message.getByRole('button', { name: 'Regenerate response', exact: true });
    await regenerate.focus();
    await expect(regenerate).toBeFocused();
    await expect(regenerate).toBeEnabled();
    await expect(regenerate.locator('svg')).toBeVisible();
    await expect(message.getByTestId('message-actions')).toHaveCSS('opacity', '1');
    await expect(message.getByRole('button', { name: 'Copy message', exact: false })).toBeVisible();
    const [proseTypography, labelTypography, reasonTypography] = await Promise.all(
      [prose.locator('p').first(), label, reason].map((text) =>
        text.evaluate((node) => {
          const style = getComputedStyle(node);
          return { fontSize: style.fontSize, lineHeight: style.lineHeight };
        }),
      ),
    );
    const alignment = {
      proseLeft: (await prose.boundingBox())!.x,
      noticeLabelLeft: (await label.boundingBox())!.x,
      noticeReasonLeft: (await reason.boundingBox())!.x,
      proseTypography,
      labelTypography,
      reasonTypography,
    };
    const captureDir = process.env.CHAT_FOLLOWUP_CAPTURE_DIR;
    if (captureDir) {
      await mkdir(captureDir, { recursive: true });
      const name = chief ? 'chief-at-bottom' : 'at-bottom';
      await component.screenshot({ path: join(captureDir, `${name}.png`) });
      await writeFile(join(captureDir, `${name}.json`), JSON.stringify(alignment, null, 2));
    }
    expect(alignment.noticeLabelLeft).toBeCloseTo(alignment.proseLeft, 1);
    expect(alignment.noticeReasonLeft).toBeCloseTo(alignment.proseLeft, 1);
    expect(labelTypography).toEqual(proseTypography);
    expect(reasonTypography).toEqual(proseTypography);

    // Focus and capture above are setup, not part of the wheel gesture. Restore
    // the bottom after focus, then take both baselines in the same settled frame.
    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await scroll.hover();
    const baseline = await settledScrollBaseline(component);
    await page.mouse.wheel(0, -180);
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeGreaterThan(150);
    if (captureDir && !chief) {
      await component.screenshot({ path: join(captureDir, 'scrolled-up.png') });
    }
    await expect
      .poll(async () => (await prompts.boundingBox())!.y - baseline.prompts.y)
      .toBeGreaterThan(150);
    const composerAfter = (await composer.boundingBox())!;
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(composerAfter[dimension]).toBeCloseTo(baseline.composer[dimension], 1);
    }
    await expect(prompts).not.toBeInViewport();

    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(prompts).toBeInViewport();
    await prompts.getByRole('button', { name: 'Edit in input' }).first().click();
    await expect(component.locator('.tiptap-editor')).toContainText(
      'Walk me through the manual checks.',
    );
  });
}

for (const { platform, modifier, chief } of [
  { platform: 'MacIntel', modifier: 'Control', chief: false },
  { platform: 'Win32', modifier: 'Alt', chief: true },
]) {
  test(`${modifier}+number only sends a follow-up with a visible shortcut hint`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((value) => {
      Object.defineProperty(navigator, 'platform', { configurable: true, get: () => value });
    }, platform);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 960, height: 720 });
    const draft = 'Keep my unsent draft';
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: { chief, followUp: 'blocker', draft, width: 900 },
    });
    const prompts = component.getByTestId('suggested-prompts-surface');
    const scroll = component.getByTestId('chat-transcript-inner').locator('..');
    const editor = component.locator('.tiptap-editor[contenteditable="true"]');
    await expect(editor).toHaveText(draft);
    await editor.focus();
    await page.evaluate(() => document.fonts.ready);
    const hints = prompts.locator('[data-suggested-prompt-hint]');
    await expect(hints).toHaveCount(2);

    await scroll.hover();
    await page.mouse.wheel(0, -250);
    await expect(prompts).not.toBeInViewport();
    await page.keyboard.press(`${modifier}+1`);
    await expect(editor).toHaveText(draft);
    await expect(prompts).not.toBeInViewport();

    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(hints.last()).toBeInViewport();
    // Keep the first hint visible but move the second below the transcript clip.
    // Checking only the list's visibility would still send the hidden second prompt.
    await scroll.evaluate((node) => {
      const second = node.querySelectorAll('[data-suggested-prompt-hint]')[1];
      node.scrollTop -=
        node.getBoundingClientRect().bottom - second.getBoundingClientRect().top + 2;
    });
    await expect(hints.first()).toBeInViewport({ ratio: 1 });
    await expect(hints.last()).not.toBeInViewport();
    await page.keyboard.press(`${modifier}+2`);
    await expect(editor).toHaveText(draft);

    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(hints.last()).toBeInViewport({ ratio: 1 });
    await page.keyboard.press(`${modifier}+2`);
    // The production send path clears the draft only when a prompt was selected.
    await expect(editor).toHaveText('');
  });
}
