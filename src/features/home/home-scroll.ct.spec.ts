import type { ComponentFixtures } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../test/ct-test';
import { failOnConsoleErrors } from '../../test/ct-console-errors';
import Preview from './home.preview.svelte';

failOnConsoleErrors(test);

type Locator = ReturnType<Awaited<ReturnType<ComponentFixtures['mount']>>['locator']>;

async function measure(host: Locator) {
  return host.evaluate((element) => {
    const home = element.querySelector<HTMLElement>('[data-home-page]')!;
    const sidebar = home.querySelector<HTMLElement>('.home-sidebar [data-slot="list-view"]')!;
    const header = home.querySelector<HTMLElement>('[data-chief-header-row]')!;
    const composer = home.querySelector<HTMLElement>('[data-testid="chat-composer-shell"]')!;
    const transcript = home.querySelector<HTMLElement>(
      '[data-testid="chat-transcript-scroll-viewport"]',
    )!;
    const bounds = (node: Element) => {
      const { top, bottom, left, right, height } = node.getBoundingClientRect();
      return { top, bottom, left, right, height };
    };
    return {
      host: bounds(element),
      header: bounds(header),
      composer: bounds(composer),
      transcript: bounds(transcript),
      pageOverflow: home.scrollHeight - home.clientHeight,
      horizontalOverflow: home.scrollWidth - home.clientWidth,
      sidebarRange: sidebar.scrollHeight - sidebar.clientHeight,
      sidebarScroll: sidebar.scrollTop,
      transcriptRange: transcript.scrollHeight - transcript.clientHeight,
      transcriptScroll: transcript.scrollTop,
      windowScroll: window.scrollY,
    };
  });
}

const cases = [
  { name: 'long thread list', width: 1440, height: 720, scenario: 'assistant-many' },
  { name: 'short window', width: 900, height: 360, scenario: 'assistant-many' },
  { name: 'stacked sidebar', width: 420, height: 540, scenario: 'assistant-many' },
  { name: 'short stacked layout', width: 420, height: 360, scenario: 'assistant-many' },
  { name: 'long conversation', width: 1440, height: 720, scenario: 'assistant-long' },
  { name: 'narrow conversation', width: 420, height: 540, scenario: 'assistant-long' },
] as const;

for (const { name, width, height, scenario } of cases) {
  test(`Home assistant contains scrolling with a ${name}`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(Preview, { props: { scenario, height } });
    const host = page.locator('[data-home-preview]');
    const composer = component.getByTestId('chat-composer-shell');
    const transcript = component.getByTestId('chat-transcript-scroll-viewport');
    const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
    await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
    await expect(composer).toBeVisible();
    await expect(component.getByTestId('chat-transcript-skeleton')).toHaveCount(0);
    if (scenario === 'assistant-long') {
      await expect(
        transcript.locator('[data-message-id="home-assistant-response-11"]'),
      ).toBeVisible();
    }
    await expect.poll(async () => (await measure(host)).pageOverflow).toBeLessThanOrEqual(1);
    const before = await measure(host);
    expect(before.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(before.header.top).toBeGreaterThanOrEqual(before.host.top);
    expect(before.composer.bottom).toBeLessThanOrEqual(before.host.bottom);
    expect(before.transcript.height).toBeGreaterThan(0);
    expect(before.transcript.bottom).toBeLessThanOrEqual(before.composer.top + 1);
    if (scenario === 'assistant-many') {
      expect(before.sidebarRange).toBeGreaterThan(0);
      await sidebar.getByRole('listbox').hover();
      await page.mouse.wheel(0, 1600);
      await expect.poll(async () => (await measure(host)).sidebarScroll).toBeGreaterThan(0);
      const sidebarScrolled = await measure(host);
      expect(sidebarScrolled.header).toEqual(before.header);
      expect(sidebarScrolled.composer).toEqual(before.composer);
      expect(sidebarScrolled.windowScroll).toBe(0);
    }

    if (scenario === 'assistant-long') {
      await expect.poll(async () => (await measure(host)).transcriptScroll).toBeGreaterThan(0);
      const position = (await measure(host)).transcriptScroll;
      await transcript.hover();
      await page.mouse.wheel(0, -600);
      await expect.poll(async () => (await measure(host)).transcriptScroll).toBeLessThan(position);
      const chatScrolled = await measure(host);
      expect(chatScrolled.header).toEqual(before.header);
      expect(chatScrolled.composer).toEqual(before.composer);
      expect(chatScrolled.windowScroll).toBe(0);
    }

    const evidence = await measure(host);
    await testInfo.attach(`home-assistant-${name}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach('scroll-boundaries.json', {
      body: JSON.stringify({ width, height, scenario, before, after: evidence }, null, 2),
      contentType: 'application/json',
    });

    await sidebar.getByRole('tab', { name: 'Workspaces', exact: true }).click();
    await expect(
      component.locator('.home-header').getByRole('tab', { name: 'Workspaces', exact: true }),
    ).toBeVisible();
    await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
    await expect(composer).toBeVisible();
    await expect.poll(async () => (await measure(host)).pageOverflow).toBeLessThanOrEqual(1);
    expect((await measure(host)).composer.bottom).toBeLessThanOrEqual(before.host.bottom);

    expect(await page.pageErrors()).toEqual([]);
  });
}
