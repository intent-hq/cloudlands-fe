import {
  test,
  expect,
  openViewer,
  apply,
  viewer,
  frame,
  field,
  button,
  choose,
  toggle,
  observations,
  navigation,
  activate,
  anchorArgs,
  mention,
  insertImage,
  pngFile,
  label,
  tabTo,
  imageActions,
  capture,
  detached,
  sameNode,
  customFence,
  mermaidFence,
  settledCustom,
  settledMermaid,
} from '../lib/markdown-viewer.mjs';

test('markdown viewer MV4: task proposal and rich fences switch through source flags', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await apply(host, '@@@task\n# Proposal title\nRead this proposal body.\n@@@');
  await expect(viewer(host).getByRole('checkbox')).toHaveCount(1);
  await expect(viewer(host).getByRole('checkbox')).toBeDisabled();
  await expect(viewer(host)).not.toContainText('Read this proposal body.');
  await choose(host, 'taskBlockRenderMode', 'content');
  await expect(viewer(host)).toContainText('Proposal title');
  await expect(viewer(host)).toContainText('Read this proposal body.');
  await capture(page, frame(host), 'mv4-task-content', info);
  await choose(host, 'taskBlockRenderMode', 'omit');
  await expect(viewer(host)).not.toContainText('Read this proposal body.');
  await apply(host, mermaidFence);
  await expect(viewer(host).locator('pre code')).toHaveCount(0);
  await choose(host, 'renderRichFencesAsCode', 'true');
  await expect(viewer(host).locator('pre code')).toHaveText('flowchart LR\n  Source --> Result\n');
  await expect(viewer(host).locator('[data-markdown-diagram]')).toHaveCount(0);
  await choose(host, 'renderRichFencesAsCode', 'false');
  await expect(viewer(host).locator('pre code')).toHaveCount(0);
  expect(navigation(await observations(host))).toEqual([]);
});

test('markdown viewer MV5: small streaming prop updates and finalized accessible math', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await choose(host, 'isStreaming', 'true');
  await apply(host, 'First math $x^2 + y^2 = z^2$');
  await expect(viewer(host)).toContainText('$x^2 + y^2 = z^2$');
  await expect(viewer(host).locator('math')).toHaveCount(0);
  await apply(host, 'Current math $a^2 + b^2 = c^2$');
  await expect(viewer(host)).toContainText('Current math');
  await expect(viewer(host)).not.toContainText('First math');
  await choose(host, 'isStreaming', 'false');
  await expect(viewer(host).locator('math')).toHaveCount(1);
  await expect(viewer(host).locator('math annotation')).toHaveText('a^2 + b^2 = c^2');
  await expect(viewer(host).locator('[data-math-source]')).toHaveAttribute(
    'data-math-source',
    '$a^2 + b^2 = c^2$',
  );
  await capture(page, frame(host), 'mv5-finalized-math', info);
  await choose(host, 'isStreaming', 'omit');
  await expect(viewer(host).locator('math')).toHaveCount(1);
  // Ordinary updates establish output only, not an in-flight cancellation or 150ms timing claim.
});

test('markdown viewer MV9: linked image keeps native anchor precedence and keyboard access', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await apply(host, '');
  const { image } = await insertImage(page, host, pngFile('linked.png'), true);
  const link = viewer(host).getByRole('link');
  await expect(image).not.toHaveAttribute('role', 'button');
  await tabTo(page, host, link);
  await expect(link).toBeFocused();
  const record = await activate(host, link, { key: 'Enter' });
  anchorArgs(record, { url: 'intent://local/note/spec', rawHref: 'intent://local/note/spec' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const clicked = await activate(host, image);
  anchorArgs(clicked, { url: 'intent://local/note/spec', rawHref: 'intent://local/note/spec' });
  expect(clicked.arguments[1].event.target.tag).toBe('IMG');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await capture(page, frame(host), 'mv9-linked-image', info);
});

test('markdown viewer MV11: sidecar sizing decoded readiness and current media props', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await apply(host, '');
  const { image, src, file } = await insertImage(page, host);
  await expect(image).not.toHaveAttribute('width');
  await field(host, 'Media sidecar JSON').fill(
    JSON.stringify({ [src]: { width: 320, height: 200 } }),
  );
  await button(host, 'Apply media JSON').click();
  await toggle(host, 'Supply media sidecar', true);
  await expect(image).toHaveAttribute('width', '320');
  await expect(image).toHaveAttribute('height', '200');
  await expect
    .poll(() =>
      image.evaluate((node) => ({
        complete: node.complete,
        width: node.naturalWidth,
        height: node.naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: file.width, height: file.height });
  await expect(viewer(host).getByTestId('media-loading-placeholder')).toHaveCount(0);
  await tabTo(page, host, image);
  await expect(image).toBeFocused();
  await capture(page, frame(host), 'mv11-sidecar-ready', info);
  await choose(host, 'chatImageThumbnails', 'true');
  await expect(image).toHaveAttribute('width', '320');
  await expect(image).toHaveAttribute('src', src);
  await field(host, 'Media sidecar JSON').fill(
    JSON.stringify({ [src]: { width: 240, height: 150 } }),
  );
  await button(host, 'Apply media JSON').click();
  await expect(image).toHaveAttribute('width', '240');
  await expect(image).toHaveAttribute('height', '150');
  await toggle(host, 'Supply media sidecar', false);
  await expect(image).not.toHaveAttribute('width');
  await expect(image).not.toHaveAttribute('height');
  await expect(image).toHaveAttribute('role', 'button');
  await capture(page, frame(host), 'mv11-omitted-sidecar', info);
  // Decoded data URLs need not expose a loading frame. No transient-loading or file-thumbnail geometry claim.
});

test('markdown viewer MV13: keyboard image actions survive pointer movement and media replacement', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await apply(host, '');
  const first = await insertImage(page, host, pngFile('first.png', 160, 100));
  const second = await insertImage(page, host, pngFile('second.png', 96, 64));
  const images = viewer(host).locator('img');
  const firstImage = images.nth(0);
  const secondImage = images.nth(1);
  await tabTo(page, host, firstImage);
  await expect(firstImage).toBeFocused();
  await expect(imageActions(host)).toHaveCount(1);
  await secondImage.hover();
  await expect(firstImage).toBeFocused();
  await imageActions(host).click();
  await expect(page.getByTestId('image-info-dimensions')).toHaveText(
    label('ui_imageActionsMenu_dimensions_label', {
      width: first.file.width,
      height: first.file.height,
    }),
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await button(host, 'Refresh observations').click();
  await secondImage.hover();
  await imageActions(host).click();
  await expect(page.getByTestId('image-info-dimensions')).toHaveText(
    label('ui_imageActionsMenu_dimensions_label', {
      width: second.file.width,
      height: second.file.height,
    }),
  );
  await capture(page, page.getByRole('menu'), 'mv13-second-image-actions', info);
  await page.keyboard.press('Escape');
  const removed = await secondImage.elementHandle();
  await apply(host, 'Both images removed.');
  await detached(removed);
  await expect(viewer(host).locator('img')).toHaveCount(0);
  await expect(imageActions(host)).toHaveCount(0);
  await button(host, 'Remount Markdown viewer').click();
  await expect(viewer(host)).toHaveText('Both images removed.');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await capture(page, frame(host), 'mv13-remounted-clean', info);
});

test('markdown viewer MV14: diagram mount kind current binding source and removal', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await choose(host, 'renderRichFencesAsCode', 'true');
  await apply(host, mermaidFence);
  await expect(viewer(host).locator('pre code')).toHaveText('flowchart LR\n  Source --> Result\n');
  await choose(host, 'renderDiagrams', 'true');
  await settledMermaid(viewer(host));
  await expect(viewer(host).locator('[data-markdown-diagram="mermaid"]')).toHaveCount(1);
  await capture(page, frame(host), 'mv14-mermaid-mounted', info);
  await apply(host, customFence);
  await settledCustom(viewer(host));
  await expect(viewer(host).locator('[data-markdown-diagram="mermaid"]')).toHaveCount(0);
  const custom = viewer(host).locator('[data-markdown-diagram="diagram"]');
  const retained = await custom.elementHandle();
  await button(host, 'Replace onOpenFile').click();
  await sameNode(custom, retained);
  const binding = viewer(host).getByRole('button', {
    name: label('diagram_node_openBinding_ariaLabel', {
      label: 'Open source document',
      type: 'file',
    }),
  });
  const record = await activate(host, binding, { name: 'onOpenFile', revision: 1 });
  expect(record.arguments).toEqual([
    'system-design',
    'docs/original.md',
    { openInAdjacentPanel: false, sourcePanelId: 'markdown-viewer-panel' },
  ]);
  await capture(page, frame(host), 'mv14-custom-mounted', info);
  await choose(host, 'renderDiagrams', 'false');
  await expect(viewer(host).locator('[data-markdown-diagram]')).toHaveCount(0);
  await detached(retained);
  await choose(host, 'renderDiagrams', 'true');
  await settledCustom(viewer(host));
  await apply(host, 'Diagram removed.');
  await expect(viewer(host).locator('[data-markdown-diagram]')).toHaveCount(0);
  await expect(viewer(host)).toHaveText('Diagram removed.');
});

test('markdown viewer MV15: denied video child composition preserves recursive Markdown callbacks', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await choose(host, 'canOpenFile', 'false');
  await choose(host, 'allowFileMedia', 'true');
  await apply(
    host,
    '# Before video\n\n![Local clip](intent://local/file/assets/clip.webm)\n\nAfter video @note/spec',
  );
  const videoChild = viewer(host).locator('[data-chat-video]');
  await expect(videoChild).toHaveCount(1);
  await expect(videoChild.getByTestId('media-unavailable')).toHaveCount(1);
  await expect(videoChild.locator('video,source,button,a')).toHaveCount(0);
  await expect(viewer(host).getByRole('heading', { level: 1 })).toHaveText('Before video');
  await button(host, 'Replace onOpenNote').click();
  await field(host, 'Context workspace ID').fill('video-context');
  const target = mention(host, 'note', 'spec');
  const record = await activate(host, target, { name: 'onOpenNote', revision: 1 });
  expect(record.arguments).toEqual([
    'video-context',
    'spec',
    { openInAdjacentPanel: false, sourcePanelId: 'markdown-viewer-panel' },
  ]);
  await capture(page, frame(host), 'mv15-denied-video-composition', info);
  const removed = await videoChild.elementHandle();
  await apply(host, '# Plain replacement\n\nNo video remains.');
  await expect(viewer(host).locator('[data-chat-video]')).toHaveCount(0);
  await detached(removed);
  // Canonical full-viewer URLs require workspace transport. Admitted playback remains unverified here.
});

test('markdown viewer MV16: long worker input current publication and settled remount', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  const workers = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await choose(host, 'isStreaming', 'true');
  await choose(host, 'Content update mode', 'change');
  const long =
    '# Long original\n\n' +
    Array.from(
      { length: 180 },
      (_, index) =>
        `Paragraph ${index}: **independent visible content** for the real worker pipeline.\n\n`,
    ).join('');
  await field(host, 'Raw Markdown content').fill(long);
  await expect(viewer(host).getByRole('heading', { level: 1 })).toHaveText('Long original');
  await expect(viewer(host)).toContainText('Paragraph 179:');
  await field(host, 'Raw Markdown content').fill('# Final current\n\nSettled math $p+q=r$');
  await choose(host, 'isStreaming', 'false');
  await expect(viewer(host).getByRole('heading', { level: 1 })).toHaveText('Final current');
  await expect(viewer(host)).not.toContainText('Long original');
  await expect(viewer(host).locator('math annotation')).toHaveText('p+q=r');
  expect(workers.some((url) => url.includes('markdown-worker'))).toBe(true);
  await info.attach('mv16-workers.json', {
    body: JSON.stringify(workers, null, 2),
    contentType: 'application/json',
  });
  const old = await viewer(host).elementHandle();
  await toggle(host, 'Mount Markdown viewer', false);
  await detached(old);
  await expect(frame(host).locator(':scope > div')).toHaveCount(0);
  await field(host, 'Raw Markdown content').fill(
    '# Remounted current\n\n[Current note](intent://local/note/current)',
  );
  await button(host, 'Replace onOpenLink').click();
  await toggle(host, 'Mount Markdown viewer', true);
  await expect(viewer(host).getByRole('heading', { level: 1 })).toHaveText('Remounted current');
  const record = await activate(host, viewer(host).getByRole('link', { name: 'Current note' }), {
    revision: 1,
  });
  anchorArgs(record, {
    url: 'intent://local/note/current',
    rawHref: 'intent://local/note/current',
  });
  await capture(page, frame(host), 'mv16-remounted-current', info);
  // Worker creation/output are observed. No pending-request, cancellation, timer, throughput or cleanup claim.
});
