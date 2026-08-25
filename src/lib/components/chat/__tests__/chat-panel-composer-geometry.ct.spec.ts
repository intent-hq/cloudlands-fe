import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);

const states = [
  {
    name: 'regular wide light at 100%',
    theme: 'light' as const,
    zoom: 1,
    width: 720,
    chief: false,
    streaming: true,
    draft: 'Short draft',
  },
  {
    name: 'Chief wide dark at 100%',
    theme: 'dark' as const,
    zoom: 1,
    width: 720,
    chief: true,
    streaming: false,
    draft: '',
  },
  {
    name: 'regular narrow dark at 200%',
    theme: 'dark' as const,
    zoom: 2,
    width: 180,
    chief: false,
    streaming: true,
    draft: 'Long streaming draft '.repeat(12),
  },
  {
    name: 'Chief narrow light at 200%',
    theme: 'light' as const,
    zoom: 2,
    width: 180,
    chief: true,
    streaming: true,
    draft: 'Chief streaming draft',
  },
];

for (const state of states) {
  test(`nests the production composer without overflow in ${state.name}`, async ({ mount }) => {
    const component = await mount(ChatPanelComposerGeometryHost, { props: state });
    const prompt = component.getByTestId('composer-prompt-layer');
    const input = component.getByTestId('message-input');
    const editor = component.locator('.editor-wrapper');
    const actionBar = component.locator('[data-chat-input-action-bar]');
    await expect(input).toBeVisible();

    const geometry = await input.evaluate((node) => {
      const shell = node.closest('[data-testid="chat-composer-shell"]')!;
      const prompt = node.closest('[data-testid="composer-prompt-layer"]')!;
      const editor = node.querySelector('.editor-wrapper')!;
      const action = node.querySelector('[data-chat-input-action-bar]')!;
      const box = node.getBoundingClientRect();
      const shellBox = shell.getBoundingClientRect();
      const promptBox = prompt.getBoundingClientRect();
      const editorBox = editor.getBoundingClientRect();
      const actionBox = action.getBoundingClientRect();
      const style = getComputedStyle(node);
      const probe = document.createElement('div');
      probe.className = 'bg-sidebar';
      document.body.append(probe);
      const sidebarBackground = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        box: [box.left, box.top, box.right, box.bottom],
        shell: [shellBox.left, shellBox.top, shellBox.right, shellBox.bottom],
        prompt: [promptBox.left, promptBox.top, promptBox.right, promptBox.bottom],
        background: style.backgroundColor,
        sidebarBackground,
        borders: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ],
        radii: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
        layersSeparated: editorBox.bottom <= actionBox.top + 0.5,
        overflow: [shell, prompt, node, editor, action].map(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      };
    });

    expect(geometry.background).toBe(geometry.sidebarBackground);
    expect(geometry.borders).toEqual(['0px', '0px', '0px', '0px']);
    expect(geometry.radii[0]).toBe(geometry.radii[1]);
    expect(Number.parseFloat(geometry.radii[0])).toBeGreaterThan(0);
    expect(geometry.box[0]).toBeGreaterThan(geometry.shell[0]);
    expect(geometry.box[2]).toBeLessThan(geometry.shell[2]);
    expect(geometry.box[1]).toBeGreaterThan(geometry.prompt[1]);
    expect(geometry.box[3]).toBeLessThan(geometry.prompt[3]);
    expect(geometry.layersSeparated).toBe(true);
    const containedOverflow = state.chief ? geometry.overflow.slice(1) : geometry.overflow;
    expect(containedOverflow.every((overflow) => overflow <= 1)).toBe(true);

    await editor.locator('.tiptap-editor').focus();
    await expect(editor.locator('.tiptap-editor')).toBeFocused();
    await expect(actionBar).toBeVisible();

    const aurora = component.getByTestId('composer-aurora-host');
    if (!state.streaming) {
      await expect(aurora).toHaveCount(0);
      return;
    }
    await expect(aurora).toBeVisible();
    const [inputGeometry, auroraGeometry, shellGeometry, panelGeometry] = await Promise.all(
      [
        input,
        aurora,
        component.getByTestId('chat-composer-shell'),
        component.locator('.panel'),
      ].map((locator) =>
        locator.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            edges: [box.left, box.right, box.bottom],
            radii: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
            overflow: style.overflow,
            pointerEvents: style.pointerEvents,
            z: style.zIndex,
          };
        }),
      ),
    );
    if (state.chief) {
      expect(auroraGeometry.edges[0]).toBeLessThan(inputGeometry.edges[0]);
      expect(auroraGeometry.edges[1]).toBeGreaterThan(inputGeometry.edges[1]);
      expect(auroraGeometry.edges[2]).toBeGreaterThan(inputGeometry.edges[2]);
      expect(auroraGeometry.radii).toEqual(['0px', '0px']);
    } else {
      const scrollbarGutter = await prompt.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).paddingInlineEnd),
      );
      expect(auroraGeometry.edges[0]).toBeCloseTo(shellGeometry.edges[0]);
      expect(auroraGeometry.edges[1]).toBeCloseTo(shellGeometry.edges[1] - scrollbarGutter);
      expect(auroraGeometry.edges[2]).toBeCloseTo(shellGeometry.edges[2]);
      expect(auroraGeometry.radii).toEqual(panelGeometry.radii);
      expect(Number.parseFloat(auroraGeometry.radii[0])).toBeGreaterThan(0);
    }
    expect(auroraGeometry.overflow).toBe('hidden');
    expect(auroraGeometry.pointerEvents).toBe('none');
    expect(Number(auroraGeometry.z)).toBeLessThan(
      Number(await prompt.evaluate((node) => getComputedStyle(node).zIndex)),
    );
    expect((await aurora.boundingBox())!.y).toBeLessThan((await input.boundingBox())!.y);
  });
}

test('keeps attachments, controls, tab order, and resize behavior inside the nested surface', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { draft: 'Resizable attachment draft', width: 420 },
  });
  const input = component.getByTestId('message-input');
  const editor = component.locator('.tiptap-editor');
  const resize = input.locator('.resize-handle');
  await component.locator('input[type="file"]').setInputFiles({
    name: 'composer.png',
    mimeType: 'image/png',
    buffer: Buffer.from('composer-image'),
  });
  const attachment = component.getByRole('img', { name: 'composer.png' });
  await expect(attachment).toBeVisible();

  const actionBar = component.locator('[data-chat-input-action-bar]');
  const attachmentBox = (await attachment.boundingBox())!;
  const actionBox = (await actionBar.boundingBox())!;
  expect(attachmentBox.y + attachmentBox.height).toBeLessThanOrEqual(actionBox.y);
  await editor.focus();
  await page.keyboard.press('Tab');
  await expect(
    component.getByRole('button', { name: 'View composer.png full size' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(component.getByRole('button', { name: 'Remove composer.png' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(component.getByRole('button', { name: 'Default model' })).toBeFocused();

  const before = (await input.boundingBox())!.height;
  const handle = (await resize.boundingBox())!;
  const handleY = handle.y + handle.height / 2;
  await resize.dispatchEvent('mousedown', { clientY: handleY });
  await page.evaluate((clientY) => {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY }));
  }, handleY - 60);
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(before);
  await expect(component.locator('[data-chat-input-submit-actions] button').last()).not.toHaveClass(
    /bg-primary/,
  );
});
