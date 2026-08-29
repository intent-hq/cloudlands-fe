import { expect, test } from '@playwright/experimental-ct-svelte';
import ToolResultRendererParityHost from './ToolResultRendererParityHost.svelte';
import {
  groupedResultBlocks,
  headinglessGroupedOrphanBlocks,
  orphanResultBlocks,
  pairedResultBlocks,
  reconcileToolResultMessage,
  rehydrateToolResultMessage,
} from './tool-result-parity-fixtures';

test('renders paired and orphan results with matching production-surface semantics', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const paired = reconcileToolResultMessage(pairedResultBlocks(), true);
  const component = await mount(ToolResultRendererParityHost, {
    props: { content: paired.contentBlocks ?? [], isStreaming: true },
  });
  const normal = component.getByTestId('normal-workspace-surface');
  const dedicated = component.getByTestId('dedicated-agent-surface');

  for (const surface of [normal, dedicated]) {
    await surface.getByTestId('tool-call-disclosure').click();
    await expect(surface.getByText('paired-result-marker', { exact: true })).toHaveCount(1);
    await expect(surface.locator('[data-message-content-block="tool_result"]')).toHaveCount(0);
  }

  const orphan = reconcileToolResultMessage(orphanResultBlocks(), true);
  await component.update({ props: { content: orphan.contentBlocks ?? [], isStreaming: false } });
  for (const surface of [normal, dedicated]) {
    const row = surface.locator('[data-message-content-block="tool_result"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('orphan-search-marker');
    await expect(row).toHaveClass(/pt-4/);
    await expect(row).toHaveAttribute('data-chat-search-block-path', 'b:1');
    expect(await row.ariaSnapshot()).toContain('orphan-search-marker');
  }
});

test('renders grouped orphans in titled and headingless groups across both surfaces', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const titled = rehydrateToolResultMessage(groupedResultBlocks());
  const component = await mount(ToolResultRendererParityHost, {
    props: { content: titled.contentBlocks ?? [], isStreaming: false },
  });

  for (const surface of [
    component.getByTestId('normal-workspace-surface'),
    component.getByTestId('dedicated-agent-surface'),
  ]) {
    const disclosure = surface.getByTestId('response-group-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.focus();
    await disclosure.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const rows = surface.locator('[data-message-content-block="tool_result"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('grouped-orphan-search-marker');
    await expect(rows.last()).toContainText('grouped-missing-id-orphan-marker');
    await expect(rows.first()).toHaveAttribute('data-chat-search-block-path', 'b:0:c:4');
    await expect(rows.first()).toHaveClass(/pt-1/);
    await expect(rows.last()).toHaveClass(/pt-4/);
    expect(await rows.first().ariaSnapshot()).toContain('grouped-orphan-search-marker');
    const [groupBox, orphanBox] = await Promise.all([
      surface.locator('[data-response-group-content]').last().boundingBox(),
      rows.last().boundingBox(),
    ]);
    expect(groupBox).not.toBeNull();
    expect(orphanBox).not.toBeNull();
    expect(orphanBox!.x).toBeGreaterThanOrEqual(groupBox!.x);
    expect(orphanBox!.x + orphanBox!.width).toBeLessThanOrEqual(groupBox!.x + groupBox!.width + 1);
  }

  const inline = reconcileToolResultMessage(headinglessGroupedOrphanBlocks(), true);
  await component.update({ props: { content: inline.contentBlocks ?? [], isStreaming: false } });
  for (const surface of [
    component.getByTestId('normal-workspace-surface'),
    component.getByTestId('dedicated-agent-surface'),
  ]) {
    await expect(surface.getByTestId('response-group-disclosure')).toHaveCount(0);
    await expect(surface.getByText('inline-orphan-marker', { exact: true })).toBeVisible();
  }
});
