import {
  test,
  expect,
  openComposition,
  control,
  copy,
  open,
  switchTo,
  clear,
  activate,
  capture,
  contained,
  sameNode,
  detached,
  label,
  setCustom,
  binding,
  fileArgs,
  minimalCustom,
  semanticError,
  changedCustom,
  settledCustom,
  settledMermaid,
  mermaidGeneration,
  visibleNodeIds,
  noNavigation,
  readableNode,
} from '../lib/markdown-composition.mjs';

test('markdown composition MC5: truncated media title updates and is removed on actual disposal', async ({
  page,
}, info) => {
  const { media } = await openComposition(page);
  const longName =
    'A local filename with a complete description that remains available when narrow '.repeat(3) +
    '.png';
  await control(media, 'name').fill(longName);
  const longTitle = media.tile.getByText(longName, { exact: true });
  await expect
    .poll(() => longTitle.evaluate((node) => node.scrollWidth > node.clientWidth))
    .toBe(true);
  await expect(longTitle).toHaveAttribute('title', longName);
  const heldTitle = await longTitle.elementHandle();
  await contained(media.tile, info);
  await capture(page, media.frame, 'MC5-long-name', info);
  await control(media, 'name').fill('x');
  const shortTitle = media.tile.getByText('x', { exact: true });
  await sameNode(shortTitle, heldTitle);
  await expect
    .poll(() => shortTitle.evaluate((node) => node.scrollWidth <= node.clientWidth))
    .toBe(true);
  await expect(shortTitle).not.toHaveAttribute('title');
  await control(media, 'name').fill(longName);
  await expect(longTitle).toHaveAttribute('title', longName);
  await switchTo(media, 'mounted', false);
  await detached(heldTitle);
  expect(await heldTitle.getAttribute('title')).toBeNull();
  await expect(media.tile).toHaveCount(0);
  await clear(media);
  await control(media, 'sibling').click();
  expect((await media.observations()).callbacks).toEqual([]);
  await control(media, 'name').fill('Current remounted media');
  await control(media, 'replace-onOpenLink').click();
  await switchTo(media, 'mounted', true);
  await expect(media.tile).toContainText('Current remounted media');
  await contained(media.tile, info);
  await expect(copy(media)).toBeEnabled();
  const record = await activate(media, open(media), {
    name: 'onOpenLink',
    revision: 1,
    mountRevision: 1,
  });
  expect(record.arguments).toEqual([
    'intent://local/file/apps/react/src/catalog/markdown-composition-examples.tsx',
    { workspaceId: 'system-design' },
  ]);
  await capture(page, media.frame, 'MC5-after', info);
  await heldTitle.dispose();
});

test('markdown composition MC8: finalized reference errors clear old content and recover through empty custom input', async ({
  page,
}, info) => {
  const { diagram } = await openComposition(page);
  await setCustom(diagram);
  const previous = await binding(diagram, 'Read local document', 'file').elementHandle();
  await capture(page, diagram.frame, 'MC8-before', info);
  // Schema-valid edge references an absent node. The original finalized parser
  // rejects this without using the serializer's noisy malformed-JSON branch.
  await control(diagram, 'source').fill(semanticError);
  await expect(diagram.frame.getByRole('alert')).toBeVisible();
  await expect(
    diagram.frame.getByLabel(label('markdown_mermaid_viewSource_label'), { exact: true }),
  ).toHaveText(semanticError);
  await expect(diagram.frame.locator('[data-node-id]')).toHaveCount(0);
  await detached(previous);
  await capture(page, diagram.frame, 'MC8-error', info);
  await control(diagram, 'source').fill('{"model":{"nodes":[]}}');
  await expect(diagram.frame.getByRole('alert')).toHaveCount(0);
  await expect(diagram.frame).toContainText(label('diagram_renderer_empty_description'));
  await expect(diagram.frame.locator('[data-node-id]')).toHaveCount(0);
  await capture(page, diagram.frame, 'MC8-empty', info);
  const current = await setCustom(diagram, changedCustom);
  await expect.poll(() => visibleNodeIds(current)).toEqual(['current']);
  await expect(diagram.frame.getByRole('alert')).toHaveCount(0);
  await capture(page, diagram.frame, 'MC8-after', info);
  await previous.dispose();
});

test('markdown composition MC9: Mermaid uses current complete code clears empty content and disposes on kind change', async ({
  page,
}, info) => {
  const { diagram } = await openComposition(page);
  const originalCustom = await diagram.frame.locator('[data-diagram-streaming]').elementHandle();
  await control(diagram, 'fixture-mermaid-valid').click();
  await detached(originalCustom);
  await settledMermaid(diagram.frame);
  await expect(diagram.presentation).toHaveAttribute('data-diagram-kind', 'mermaid');
  await capture(page, diagram.frame, 'MC9-before', info);
  const generation = await mermaidGeneration(diagram.frame);
  const currentCode = 'flowchart TB\n  A[Current reader] --> B[Current outcome]';
  await control(diagram, 'source').fill(currentCode);
  const current = await settledMermaid(diagram.frame, generation);
  await expect(current).toContainText('Current reader');
  await expect(current).toContainText('Current outcome');
  const viewSource = diagram.frame.getByRole('button', {
    name: label('markdown_mermaid_viewSource_label'),
    exact: true,
  });
  await viewSource.press('Enter');
  await expect(
    diagram.frame.getByRole('region', {
      name: label('markdown_mermaid_viewSource_label'),
      exact: true,
    }),
  ).toHaveText(currentCode);
  const heldSvg = await current.elementHandle();
  await control(diagram, 'source').fill('');
  await expect(diagram.frame.locator('svg[data-layout-generation]')).toHaveCount(0);
  await expect(diagram.frame.getByRole('alert')).toHaveCount(0);
  await expect(viewSource).toHaveCount(0);
  await detached(heldSvg);
  await capture(page, diagram.frame, 'MC9-empty', info);
  const mermaid = await diagram.frame.locator('[data-render-generation]').elementHandle();
  await setCustom(diagram, minimalCustom);
  await detached(mermaid);
  await expect(diagram.presentation).toHaveAttribute('data-diagram-kind', 'custom');
  const custom = await diagram.frame.locator('[data-diagram-streaming]').elementHandle();
  await control(diagram, 'fixture-mermaid-valid').click();
  await detached(custom);
  await settledMermaid(diagram.frame);
  await capture(page, diagram.frame, 'MC9-after', info);
  for (const handle of [originalCustom, heldSvg, mermaid, custom]) await handle.dispose();
});

test('markdown composition MC10: narrow diagram bindings remain readable across no-op states and actual remount', async ({
  page,
}, info) => {
  const { diagram } = await openComposition(page);
  const longLabel = 'Review the local verification document with the full filename and context';
  const source = JSON.stringify({
    model: {
      nodes: [
        { id: 'long', label: longLabel, binding: { type: 'file', target: 'docs/current.md' } },
        { id: 'empty', label: 'Empty reference', binding: { type: 'file', target: '' } },
        {
          id: 'symbol',
          label: 'Symbol reference',
          binding: { type: 'symbol', target: 'ReviewSymbol' },
        },
      ],
    },
  });
  await setCustom(diagram, source);
  const target = binding(diagram, longLabel, 'file');
  await readableNode(diagram, target, info);
  await capture(page, diagram.frame, 'MC10-before', info);
  await clear(diagram);
  await noNavigation(diagram, binding(diagram, 'Empty reference', 'file'));
  await noNavigation(diagram, binding(diagram, 'Symbol reference', 'symbol'));
  await switchTo(diagram, 'omit-workspace', true);
  await noNavigation(diagram, target);
  await switchTo(diagram, 'omit-workspace', false);
  await control(diagram, 'workspace').fill('');
  await noNavigation(diagram, target);
  await control(diagram, 'workspace').fill('workspace-restored');
  const oldTarget = await target.elementHandle();
  await switchTo(diagram, 'mounted', false);
  await detached(oldTarget);
  await expect(diagram.presentation).toHaveCount(0);
  await control(diagram, 'sibling').click();
  expect((await diagram.observations()).callbacks).toEqual([]);
  await control(diagram, 'replace-onOpenFile').click();
  await switchTo(diagram, 'mounted', true);
  await settledCustom(diagram.frame);
  await readableNode(diagram, target, info);
  fileArgs(
    await activate(diagram, target, {
      name: 'onOpenFile',
      revision: 1,
      mountRevision: 1,
      via: 'Enter',
    }),
    'workspace-restored',
    'docs/current.md',
    false,
    'markdown-inner',
  );
  const firstRemount = await target.elementHandle();
  await control(diagram, 'remount').click();
  await detached(firstRemount);
  await settledCustom(diagram.frame);
  fileArgs(
    await activate(diagram, target, {
      name: 'onOpenFile',
      revision: 1,
      mountRevision: 2,
      via: 'Space',
    }),
    'workspace-restored',
    'docs/current.md',
    false,
    'markdown-inner',
  );
  await readableNode(diagram, target, info);
  await capture(page, diagram.frame, 'MC10-after', info);
  await oldTarget.dispose();
  await firstRemount.dispose();
});
