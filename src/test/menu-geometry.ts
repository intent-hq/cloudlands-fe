import { expect, type test } from './ct-test';

// CT and the top-level Playwright package use different versions; match the fixture.
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['locator']>;

/** Measure painted text, including anonymous flex text, rather than a stretched wrapper. */
export async function menuTextGeometry(label: Locator) {
  return label.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.textContent?.trim() && !node.parentElement?.closest('[aria-hidden="true"]')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const text = walker.nextNode();
    if (!text) throw new Error('Expected visible menu label text');
    const range = document.createRange();
    range.selectNodeContents(text);
    const lines = Array.from(range.getClientRects());
    const first = lines[0];
    const menu = element.closest('[role="menu"]')?.getBoundingClientRect();
    return {
      left: first.left - (menu?.left ?? 0),
      center: first.top + first.height / 2,
      lines: lines.length,
    };
  });
}

export async function expectDestructiveMenuInk(row: Locator) {
  const page = row.page();
  const checkColor = async () => {
    const colors = await row.evaluate((element) => {
      const icon = element.querySelector('svg');
      const menu = element.closest('[role="menu"]');
      if (!icon || !menu) throw new Error('Expected destructive menu icon');
      return {
        label: getComputedStyle(element).color,
        icon: getComputedStyle(icon).color,
        opacity: getComputedStyle(icon).opacity,
        normal: getComputedStyle(menu).color,
      };
    });
    expect(colors.icon).toBe(colors.label);
    expect(colors.label).not.toBe(colors.normal);
    expect(colors.opacity).toBe('1');
  };
  await row.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await row.evaluate((element) => element.closest<HTMLElement>('[role="menu"]')?.focus());
  await expect(row).not.toBeFocused();
  await checkColor();
  await row.hover();
  await checkColor();
  await page.mouse.move(0, 0);
  await row.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await expect(row).toBeFocused();
  await checkColor();
}
