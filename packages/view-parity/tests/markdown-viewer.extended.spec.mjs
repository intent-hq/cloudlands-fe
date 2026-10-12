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
  pickImage,
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
  const handles = [];
  const holdImage = async () => {
    const handle = await image.elementHandle();
    expect(handle).not.toBeNull();
    handles.push(handle);
    return handle;
  };
  // Proposed passive observation only: no DOM, application state or globals are written.
  const identityLog = await viewer(host).evaluateHandle((root) => {
    const rows = [];
    const ids = new WeakMap();
    let nextId = 0;
    const identify = (node) => {
      if (!ids.has(node)) ids.set(node, ++nextId);
      return ids.get(node);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const removed of record.removedNodes) {
          const images =
            removed instanceof HTMLImageElement
              ? [removed]
              : removed instanceof Element
                ? [...removed.querySelectorAll('img')]
                : [];
          for (const removedImage of images) {
            rows.push({
              id: identify(removedImage),
              connected: removedImage.isConnected,
              withinViewer: root.contains(removedImage),
            });
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return {
      read: (previous, current) => ({
        previousId: previous ? identify(previous) : null,
        currentId: current ? identify(current) : null,
        sameNode: previous && current ? previous === current : null,
        previousConnected: previous?.isConnected ?? null,
        currentConnected: current?.isConnected ?? null,
        currentWithinViewer: current ? root.contains(current) : null,
        rows,
      }),
      disconnect: () => observer.disconnect(),
    };
  });
  const replacedImage = async (previous, name) => {
    await detached(previous);
    await expect(imageActions(host)).toHaveCount(0);
    await expect(viewer(host).getByTestId('markdown-image-actions-overlay')).toHaveCount(0);
    await expect(page.getByRole('menu')).toHaveCount(0);
    const current = await holdImage();
    const identity = await identityLog.evaluate(
      (log, pair) => log.read(pair.previous, pair.current),
      { previous, current },
    );
    await info.attach(`${name}-identity.json`, {
      body: JSON.stringify(identity, null, 2),
      contentType: 'application/json',
    });
    expect(identity).toMatchObject({
      sameNode: false,
      previousConnected: false,
      currentConnected: true,
      currentWithinViewer: true,
    });
    expect(identity.rows).toContainEqual({
      id: identity.previousId,
      connected: false,
      withinViewer: false,
    });
    return { current, identity };
  };
  const currentActions = async (name, expectedSource, expectedName) => {
    await expect(image).toHaveAttribute('src', expectedSource);
    await expect(image).toHaveAttribute('alt', expectedName);
    const options = imageActions(host);
    await expect(options).toBeVisible();
    await expect(options).toHaveAttribute('aria-haspopup', 'menu');
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    const state = {
      aria: await frame(host).ariaSnapshot(),
      image: await image.boundingBox(),
      options: await options.boundingBox(),
      src: await image.getAttribute('src'),
      alt: await image.getAttribute('alt'),
    };
    await info.attach(`${name}-actions.json`, {
      body: JSON.stringify(state, null, 2),
      contentType: 'application/json',
    });
    expect(state.image).not.toBeNull();
    expect(state.options).not.toBeNull();
    expect(state.options.x).toBeGreaterThanOrEqual(state.image.x);
    expect(state.options.y).toBeGreaterThanOrEqual(state.image.y);
    expect(state.options.x + state.options.width).toBeLessThanOrEqual(
      state.image.x + state.image.width,
    );
    expect(state.options.y + state.options.height).toBeLessThanOrEqual(
      state.image.y + state.image.height,
    );
  };
  try {
    const unsized = await holdImage();
    await expect(image).not.toHaveAttribute('width');
    await field(host, 'Media sidecar JSON').fill(
      JSON.stringify({ [src]: { width: 320, height: 200 } }),
    );
    await button(host, 'Apply media JSON').click();
    await toggle(host, 'Supply media sidecar', true);
    await expect(image).toHaveAttribute('width', '320');
    await expect(image).toHaveAttribute('height', '200');
    const sized = await replacedImage(unsized, 'mv11-sized');
    // The current image was genuinely reparented into its production sizing frame.
    expect(sized.identity.rows).toContainEqual({
      id: sized.identity.currentId,
      connected: true,
      withinViewer: true,
    });
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
    await currentActions('mv11-sized', src, file.name);
    await capture(page, frame(host), 'mv11-sidecar-ready', info);
    await choose(host, 'chatImageThumbnails', 'true');
    await expect(image).toHaveAttribute('width', '320');
    await expect(image).toHaveAttribute('src', src);
    await sameNode(image, sized.current);
    await field(host, 'Media sidecar JSON').fill(
      JSON.stringify({ [src]: { width: 240, height: 150 } }),
    );
    await button(host, 'Apply media JSON').click();
    await expect(image).toHaveAttribute('width', '240');
    await expect(image).toHaveAttribute('height', '150');
    const resized = await replacedImage(sized.current, 'mv11-resized');
    await tabTo(page, host, image);
    await expect(image).toBeFocused();
    await currentActions('mv11-resized', src, file.name);
    await toggle(host, 'Supply media sidecar', false);
    await expect(image).not.toHaveAttribute('width');
    await expect(image).not.toHaveAttribute('height');
    await expect(image).toHaveAttribute('role', 'button');
    const omitted = await replacedImage(resized.current, 'mv11-omitted');
    await image.hover();
    await currentActions('mv11-omitted', src, file.name);
    await capture(page, frame(host), 'mv11-omitted-sidecar', info);
    // Decoded data URLs need not expose a loading frame. No transient-loading or file-thumbnail geometry claim.
    const nextFile = pngFile('current-viewer-image.png', 96, 64);
    const nextSource = await pickImage(page, host, nextFile);
    await apply(host, `![${nextFile.name}](${nextSource})`);
    await replacedImage(omitted.current, 'mv11-content-replaced');
    await image.hover();
    await currentActions('mv11-current-content', nextSource, nextFile.name);
    await image.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByTestId('image-info-dimensions')).toHaveText(
      label('ui_imageActionsMenu_dimensions_label', {
        width: nextFile.width,
        height: nextFile.height,
      }),
    );
    await capture(page, page.getByRole('menu'), 'mv11-current-image-menu', info);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    const records = await observations(host);
    expect(records.native).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'contextmenu-capture',
          type: 'contextmenu',
          isTrusted: true,
          target: expect.objectContaining({ tag: 'IMG' }),
        }),
      ]),
    );
    expect(navigation(records)).toEqual([]);
  } finally {
    await identityLog.evaluate((log) => log.disconnect());
    const identities = await identityLog.evaluate((log) => log.read(null, null));
    await info.attach('mv11-all-image-identities.json', {
      body: JSON.stringify(identities, null, 2),
      contentType: 'application/json',
    });
    await identityLog.dispose();
    for (const handle of handles) await handle.dispose();
  }
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
