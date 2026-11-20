import StickyScrollStabilityHost from './StickyScrollStabilityHost.svelte';
import type { AgentMessage } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import Preview from '../pinned-row-parity.preview.svelte';

const cases = [
  { name: 'sender avatar', kind: 'agent', narrow: false },
  { name: 'wrapping monospace sender', kind: 'agent', narrow: true },
  { name: 'event avatar and summary', kind: 'event', narrow: false },
  { name: 'hook wake', kind: 'hook', narrow: false },
  { name: 'PR wake', kind: 'pr', narrow: false },
  { name: 'Chief sender', kind: 'chief', narrow: false },
] as const;

for (const scenario of cases) {
  test(`pinned ${scenario.name} returns to its source without opening details`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      scenario.narrow,
    );
    const component = await mount(Preview, {
      props: { kind: scenario.kind, narrow: scenario.narrow },
    });
    await page.evaluate(() => document.fonts.ready);
    const source = component.getByTestId('source-0');
    const scroll = component.getByTestId('sticky-scroll');
    const scrollHeight = await scroll.evaluate((node) => node.scrollHeight);
    const entry = await source.evaluate((node) => {
      const viewport = node.closest<HTMLElement>('[data-testid="sticky-scroll"]')!;
      return (
        viewport.scrollTop +
        node.getBoundingClientRect().bottom -
        viewport.getBoundingClientRect().top +
        2
      );
    });
    const pinned = component.getByTestId('pinned-user-prompt');

    for (const activation of ['Enter', 'Space', 'click'] as const) {
      await scroll.evaluate((node, top) => node.scrollTo(0, top), entry);
      await expect(pinned).toBeVisible();
      expect(await scroll.evaluate((node) => node.scrollHeight)).toBe(scrollHeight);
      expect(await scroll.evaluate((node) => node.scrollTop)).toBeCloseTo(entry, 1);
      await expect(pinned).not.toContainText('Details are available only in the expanded source.');
      await expect(pinned.locator('button button, button a')).toHaveCount(0);
      await expect(pinned.locator('[aria-expanded], [aria-controls]')).toHaveCount(0);
      const target = pinned.getByRole('button').last();
      await target.focus();
      await expect(target).toBeFocused();
      if (activation === 'click') await target.click();
      else await page.keyboard.press(activation);
      await expect(pinned).toHaveCount(0);
      await expect(source).toBeInViewport();
    }
  });
}

test('pinned capture preview hides context and returns to the unchanged source', async ({
  mount,
  page,
}, info) => {
  const { buildDockEvidenceContext, buildDockEvidenceMetadata, emptyDockEvidence } =
    await import('$shared/dock-evidence');
  const evidence = emptyDockEvidence('sticky-capture');
  const context = { workspaceId: 'w', agentId: 'a', appUrl: 'intent://local/workspace/w' };
  const content = `${buildDockEvidenceContext(evidence, context)}\n\nReview this capture`;
  const message: AgentMessage = {
    id: 'capture',
    role: 'user',
    timestamp: '2026-11-20T12:00:00Z',
    contentBlocks: [{ type: 'text', text: content }],
    metadata: { ...buildDockEvidenceMetadata(evidence, context), edited_captures: [] },
  };
  await page.setViewportSize({ width: 900, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(StickyScrollStabilityHost, {
    props: { turnMessages: [message], width: 620, responseHeight: 600 },
  });
  const scroll = component.getByTestId('sticky-scroll');
  const source = component.getByTestId('source-0');
  const entry = await source.evaluate((node) => {
    const viewport = node.closest<HTMLElement>('[data-testid="sticky-scroll"]')!;
    return (
      viewport.scrollTop +
      node.getBoundingClientRect().bottom -
      viewport.getBoundingClientRect().top +
      2
    );
  });
  await scroll.evaluate((node, top) => node.scrollTo(0, top), entry);
  const pinned = component.getByTestId('pinned-user-prompt');
  await expect(pinned).toBeVisible();
  await info.attach('capture-sticky.png', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await expect(pinned.getByTestId('pinned-user-prompt-text')).toHaveText('Review this capture');
  await expect(pinned).toHaveAccessibleDescription('Review this capture');
  await pinned.focus();
  await page.keyboard.press('Enter');
  await expect(pinned).toHaveCount(0);
  await expect(source).toBeInViewport();
  await expect(source).toContainText('Review this capture');
  expect(message.contentBlocks![0]).toEqual({ type: 'text', text: content });
});
