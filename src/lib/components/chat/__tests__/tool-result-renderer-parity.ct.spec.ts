import { expect, test } from '@playwright/experimental-ct-svelte';
import ToolResultRendererParityHost from './ToolResultRendererParityHost.svelte';
import {
  groupedObjectEnvelopeOrphanBlocks,
  groupedResultBlocks,
  markdownImageOrphanBlocks,
  objectEnvelopeOrphanBlocks,
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
    const payload = row.locator('[data-tool-result-payload]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('orphan-search-marker');
    await expect(row).toHaveClass(/pt-4/);
    await expect(row).not.toHaveAttribute('data-chat-search-block-path', /.+/);
    await expect(payload).toHaveAttribute('data-chat-search-block-path', 'b:1');
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
    await expect(rows.first()).not.toHaveAttribute('data-chat-search-block-path', /.+/);
    await expect(rows.first().locator('[data-tool-result-payload]')).toHaveAttribute(
      'data-chat-search-block-path',
      'b:0:c:4',
    );
    await expect(rows.first()).toHaveClass(/pt-2/);
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

test('renders object-envelope orphan text at payload-scoped search paths', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const topLevel = reconcileToolResultMessage(objectEnvelopeOrphanBlocks(), true);
  const component = await mount(ToolResultRendererParityHost, {
    props: { content: topLevel.contentBlocks ?? [], isStreaming: true },
  });
  for (const surface of [
    component.getByTestId('normal-workspace-surface'),
    component.getByTestId('dedicated-agent-surface'),
  ]) {
    const payload = surface.locator('[data-chat-search-block-path="b:0"]');
    await expect(payload).toHaveText('object-orphan-marker');
    await expect(payload).not.toContainText('Tool Result');
  }

  const grouped = reconcileToolResultMessage(groupedObjectEnvelopeOrphanBlocks(), true);
  await component.update({ props: { content: grouped.contentBlocks ?? [], isStreaming: true } });
  for (const surface of [
    component.getByTestId('normal-workspace-surface'),
    component.getByTestId('dedicated-agent-surface'),
  ]) {
    const disclosure = surface.getByTestId('response-group-disclosure');
    if ((await disclosure.count()) > 0) await disclosure.click();
    const payload = surface.locator('[data-chat-search-block-path="b:0:c:3"]');
    await expect(payload).toHaveText('grouped-object-orphan-marker');
    await expect(payload).not.toContainText('Tool Result');
    await expect(surface.getByText('grouped-object-orphan-marker', { exact: true })).toHaveCount(1);
  }
});

test('shows unavailable markdown image fallbacks on both browser surfaces', async ({ mount }) => {
  const message = reconcileToolResultMessage(markdownImageOrphanBlocks(), true);
  const component = await mount(ToolResultRendererParityHost, {
    props: { content: message.contentBlocks ?? [], isStreaming: true },
  });
  for (const surface of [
    component.getByTestId('normal-workspace-surface'),
    component.getByTestId('dedicated-agent-surface'),
  ]) {
    await expect(surface.getByText('File is missing.', { exact: true })).toHaveCount(1);
    await expect(surface.getByText('Media could not load.', { exact: true })).toHaveCount(1);
    await expect(surface.getByRole('button', { name: 'Copy path' })).toHaveCount(1);
    await expect(surface.getByTestId('markdown-image-actions-overlay')).toHaveCount(0);
  }
});
