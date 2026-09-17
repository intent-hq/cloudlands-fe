import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import WorkspaceSetupCard from '../messages/WorkspaceSetupCard.svelte';

async function expectAttachedPunctuation(link: Locator, label: string, punctuation: string) {
  const geometry = await link.evaluate((node, text) => {
    const sentence = node.closest('[data-testid="workspace-setup-step-content"]')!;
    const walker = document.createTreeWalker(sentence, NodeFilter.SHOW_TEXT);
    const characters: { node: Node; offset: number; value: string }[] = [];
    let child: Node | null;
    while ((child = walker.nextNode())) {
      for (let offset = 0; offset < (child.textContent?.length ?? 0); offset += 1) {
        characters.push({ node: child, offset, value: child.textContent![offset] });
      }
    }
    const content = characters.map((character) => character.value).join('');
    const start = content.indexOf(text);
    if (start < 0) throw new Error('Reference label not found in sentence');
    const lastIndex = start + text.length - 1;
    const next = characters.slice(lastIndex + 1).find((character) => character.value.trim());
    if (!next) throw new Error('No punctuation after reference');
    const bounds = (character: (typeof characters)[number]) => {
      const range = document.createRange();
      range.setStart(character.node, character.offset);
      range.setEnd(character.node, character.offset + 1);
      return range.getBoundingClientRect();
    };
    const last = bounds(characters[lastIndex]);
    const mark = bounds(next);
    return { punctuation: next.value, gap: mark.left - last.right, line: mark.top - last.top };
  }, label);
  expect(geometry.punctuation).toBe(punctuation);
  expect(geometry.line).toBeCloseTo(0, 1);
  expect(geometry.gap).toBeCloseTo(0, 1);
}

for (const status of ['active', 'done'] as const) {
  test(`keeps ${status} setup links inline with matching text metrics`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 600 });
    let terminalFocuses = 0;
    const component = await mount(WorkspaceSetupCard, {
      props: {
        repoName: 'sample-project',
        repoPath: '/demo/sample-project',
        worktreePath: '/demo/workspaces/ui-polish',
        branch: 'ui-polish',
        specialistId: 'developer',
        setupScriptStatus: status,
        onFocusSetupTerminal: () => {
          terminalFocuses += 1;
        },
        repoStatus: status,
        branchStatus: status,
        agentStatus: status,
      },
    });
    await page.evaluate(() => document.fonts.ready);
    const links = component.getByRole('button');
    for (const link of await links.all()) {
      const metrics = await link.evaluate((node) => {
        const style = getComputedStyle(node);
        const sentence = getComputedStyle(
          node.closest('[data-testid="workspace-setup-step-content"]')!,
        );
        return {
          display: style.display,
          font: style.fontSize,
          sentenceFont: sentence.fontSize,
          lineHeight: style.lineHeight,
          sentenceLineHeight: sentence.lineHeight,
          weight: style.fontWeight,
          sentenceWeight: sentence.fontWeight,
          padding: style.padding,
          verticalAlign: style.verticalAlign,
        };
      });
      // Native buttons compute display:inline as inline-block in Chromium.
      expect(['inline', 'inline-block']).toContain(metrics.display);
      expect(metrics.font).toBe(metrics.sentenceFont);
      expect(metrics.lineHeight).toBe(metrics.sentenceLineHeight);
      expect(metrics.weight).toBe(metrics.sentenceWeight);
      expect(metrics.padding).toBe('0px');
      expect(metrics.verticalAlign).toBe('baseline');
    }
    const icon = await component.getByTestId('workspace-setup-step-icon').first().boundingBox();
    const sentence = await component
      .getByTestId('workspace-setup-step-content')
      .first()
      .boundingBox();
    expect(sentence!.x - icon!.x - icon!.width).toBeCloseTo(4, 1);
    await expectAttachedPunctuation(
      component.getByRole('button', { name: 'origin/main', exact: true }),
      'origin/main',
      status === 'active' ? '…' : '.',
    );

    if (status === 'done') {
      const terminal = component.getByRole('button', { name: 'a terminal tab', exact: true });
      const punctuationGap = await terminal.evaluate((node) => {
        const sentence = node.closest('[data-testid="workspace-setup-step-content"]')!;
        const walker = document.createTreeWalker(sentence, NodeFilter.SHOW_TEXT);
        let text: Node | null;
        while ((text = walker.nextNode())) {
          if (text.textContent !== '.') continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          return range.getBoundingClientRect().left - node.getBoundingClientRect().right;
        }
        return Number.NaN;
      });
      expect(punctuationGap).toBeCloseTo(0, 1);
      await terminal.click();
      await expect.poll(() => terminalFocuses).toBe(1);
    }

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await component.getByRole('button', { name: 'sample-project', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('/demo/sample-project');
    await component.getByRole('button', { name: 'Developer', exact: true }).focus();
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    await expect(page.getByRole('tooltip')).toBeVisible();
  });
}

for (const width of [280, 360]) {
  test(`keeps punctuation attached to wrapped references at ${width}px without hover shifts`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const component = await mount(WorkspaceSetupCard, {
      props: {
        repoName: 'a-very-long-repository-name-without-spaces',
        repoPath: '/demo/sample-project',
        worktreePath: '/demo/workspaces/a-very-long-workspace-name-without-spaces',
        branch: 'a-very-long-feature-branch-without-spaces',
        specialistId: 'developer',
        repoStatus: 'done',
        branchStatus: 'done',
        agentStatus: 'done',
      },
    });
    await page.evaluate(() => document.fonts.ready);
    for (const sentence of await component.getByTestId('workspace-setup-step-content').all()) {
      const metrics = await sentence.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const bounds = node.getBoundingClientRect();
        return {
          right: bounds.right,
          textRight: Math.max(...Array.from(range.getClientRects(), (rect) => rect.right)),
          width: node.clientWidth,
          scrollWidth: node.scrollWidth,
        };
      });
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
      expect(metrics.textRight).toBeLessThanOrEqual(metrics.right + 1);
    }
    const path = component.getByRole('button', {
      name: '/demo/workspaces/a-very-long-workspace-name-without-spaces',
      exact: true,
    });
    const branch = component.getByRole('button', {
      name: 'a-very-long-feature-branch-without-spaces',
      exact: true,
    });
    await expectAttachedPunctuation(
      path,
      '/demo/workspaces/a-very-long-workspace-name-without-spaces',
      '.',
    );
    await expectAttachedPunctuation(branch, 'a-very-long-feature-branch-without-spaces', ',');
    await expectAttachedPunctuation(
      component.getByRole('button', { name: 'origin/main', exact: true }),
      'origin/main',
      '.',
    );
    const height = (await component.boundingBox())!.height;
    await branch.hover();
    expect((await component.boundingBox())!.height).toBeCloseTo(height, 1);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await branch.press('Enter');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('a-very-long-feature-branch-without-spaces');
    await path.press('Space');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('/demo/workspaces/a-very-long-workspace-name-without-spaces');
  });
}
