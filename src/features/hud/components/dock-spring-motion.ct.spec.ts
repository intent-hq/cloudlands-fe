import type { Locator } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test.use({ video: 'on' });

const reveal = async (shell: Locator) => Number(await shell.getAttribute('data-reveal'));

test('notch spring carries closing velocity when reopened and settles without bounce', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  const now = new Date('2026-11-06T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const component = await mount(DockRailPreview, { props: dockRailPreview.states.notch.props });
  const shell = component.getByTestId('dock-shell');
  const surface = component.getByTestId('dock-surface');
  const samples: { phase: string; reveal: number }[] = [];
  await test.info().attach('before', { body: await page.screenshot(), contentType: 'image/png' });
  await surface.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  await page.clock.runFor(120);
  for (let i = 0; i < 32; i++) {
    await page.clock.runFor(16);
    samples.push({ phase: 'open', reveal: await reveal(shell) });
  }
  await expect(shell).toHaveAttribute('data-reveal', '1');
  const opening = samples.map((s) => s.reveal);
  expect(opening.some((value) => value > 0 && value < 1)).toBe(true);
  expect(opening.every((value, i) => i === 0 || value >= opening[i - 1])).toBe(true);

  await surface.dispatchEvent('pointerleave', { pointerType: 'mouse', clientX: 0, clientY: 599 });
  await page.clock.runFor(160);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await page.clock.runFor(32);
  const before = await reveal(shell);
  expect(before).toBeGreaterThan(0.1);
  expect(before).toBeLessThan(0.95);
  await surface.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  expect(await reveal(shell)).toBe(before);
  const reversed: number[] = [];
  for (let i = 0; i < 32; i++) {
    await page.clock.runFor(16);
    const value = await reveal(shell);
    reversed.push(value);
    samples.push({ phase: 'reopen', reveal: value });
  }
  // Retained closing momentum continues briefly before turning toward the new target.
  expect(Math.min(...reversed.slice(0, 2))).toBeLessThan(before);
  await expect(shell).toHaveAttribute('data-reveal', '1');
  expect(samples.every((s) => s.reveal >= 0 && s.reveal <= 1)).toBe(true);
  await test.info().attach('after', { body: await page.screenshot(), contentType: 'image/png' });
  await test.info().attach('reversal-frames.json', {
    body: JSON.stringify({ beforeRetarget: before, frameStepMs: 16, samples }, null, 2),
    contentType: 'application/json',
  });
  await surface.dispatchEvent('pointerleave', { pointerType: 'mouse', clientX: 0, clientY: 599 });
  await page.clock.runFor(700);
  await expect(shell).toHaveAttribute('data-reveal', '0');
});

test('reduced motion cancels an active spring and keyboard opening stays immediate', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const now = new Date('2026-11-06T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const component = await mount(DockRailPreview, { props: dockRailPreview.states.notch.props });
  const shell = component.getByTestId('dock-shell');
  const surface = component.getByTestId('dock-surface');
  await surface.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  await page.clock.runFor(168);
  expect(await reveal(shell)).toBeGreaterThan(0);
  expect(await reveal(shell)).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await surface.dispatchEvent('pointerleave', { pointerType: 'mouse', clientX: 0, clientY: 599 });
  await page.clock.runFor(160);
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await component.update({ props: { ...dockRailPreview.states.notch.props, focusRequest: 1 } });
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await test.info().attach('reduced-motion', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
