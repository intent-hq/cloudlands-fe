import { expect, test } from '@playwright/experimental-ct-svelte';
import ToolResultRendererParityHost from './ToolResultRendererParityHost.svelte';
import {
  orphanResultBlocks,
  pairedResultBlocks,
  reconcileToolResultMessage,
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
