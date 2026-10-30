import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../../test/ct-test';
import ConversationWireHarness from './DockConversationWireHarness.svelte';

/**
 * The dock conversation header: workspace first, agent below, a larger workspace avatar,
 * Back on the left and open-in-full on the right. Notch chrome is black; floating and
 * side use the panel background. Screenshots go to .intent/artifacts/dock-header-*.png.
 */
const PHASE = process.env.DOCK_HEADER_PHASE ?? 'after';
const ARTIFACTS = resolve(process.cwd(), '../../.intent/artifacts');

for (const chrome of ['notch', 'panel'] as const) {
  test(`dock conversation header leads with the workspace (${chrome})`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const component = await mount(ConversationWireHarness, {
      props: { width: 420, height: 320, notchChrome: chrome === 'notch' },
    });
    const header = component.locator('[data-dock-chrome]').first();
    await expect(header).toBeVisible();
    await expect(component.locator('[data-dock-conversation-back]')).toBeVisible();
    await mkdir(ARTIFACTS, { recursive: true });
    await header.screenshot({ path: resolve(ARTIFACTS, `dock-header-${PHASE}-${chrome}.png`) });
    const height = (await header.boundingBox())!.height;
    await writeFile(
      resolve(ARTIFACTS, `dock-header-${PHASE}-${chrome}.json`),
      JSON.stringify({ height }),
    );
    if (PHASE === 'before') return;

    const identity = header.locator('[data-dock-header-identity]');
    const [workspaceLine, agentLine] = await Promise.all([
      identity.locator('[data-dock-header-workspace]').boundingBox(),
      identity.locator('[data-dock-header-agent]').boundingBox(),
    ]);
    // Workspace on top, agent below.
    expect(workspaceLine!.y + workspaceLine!.height).toBeLessThanOrEqual(agentLine!.y + 1);
    // A larger leading visual, vertically centred on the two lines.
    const avatar = await header
      .locator('[data-dock-header-avatar] [data-agent-avatar]')
      .boundingBox();
    expect(avatar!.width).toBeGreaterThanOrEqual(28);
    expect(avatar!.width).toBeLessThanOrEqual(32);
    const linesMid = (workspaceLine!.y + agentLine!.y + agentLine!.height) / 2;
    expect(Math.abs(avatar!.y + avatar!.height / 2 - linesMid)).toBeLessThanOrEqual(2);
    // Back stays first and open-in-full last; the header keeps its compact height.
    const [back, open, box] = await Promise.all([
      component.locator('[data-dock-conversation-back]').boundingBox(),
      header.getByRole('button', { name: /open/i }).last().boundingBox(),
      header.boundingBox(),
    ]);
    expect(back!.x).toBeLessThan(avatar!.x);
    expect(open!.x).toBeGreaterThan(agentLine!.x);
    expect(box!.height).toBeLessThanOrEqual(53);
  });
}
