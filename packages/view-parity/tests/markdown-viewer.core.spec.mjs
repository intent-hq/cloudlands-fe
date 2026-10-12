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
  clear,
  activate,
  anchorArgs,
  mentionEvent,
  assertPastedPng,
  mention,
  insertImage,
  imageActions,
  label,
  tabTo,
  capture,
  detached,
  inputs,
  sameNode,
} from '../lib/markdown-viewer.mjs';

test('markdown viewer MV1: plain empty current content and optional omissions', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await apply(host, 'First plain line\nSecond plain line');
  await choose(host, 'allowFileMedia', 'omit');
  await expect(viewer(host)).toHaveText('First plain line\nSecond plain line');
  await expect(viewer(host).locator('p')).toHaveCount(1);
  const retained = await viewer(host).elementHandle();
  await field(host, 'className').fill('verification-caller-class');
  await toggle(host, 'Supply className', true);
  await sameNode(viewer(host), retained);
  await capture(page, frame(host), 'mv1-plain', info);
  await apply(host, '');
  await expect(viewer(host)).toHaveText('');
  await expect(viewer(host).locator('a,img,video')).toHaveCount(0);
  await apply(host, 'Next plain text <not-a-control>');
  await expect(viewer(host)).toHaveText('Next plain text <not-a-control>');
  await expect(viewer(host).locator('not-a-control')).toHaveCount(0);
  await toggle(host, 'Supply className', false);
  expect((await inputs(host)).optionalProps).not.toHaveProperty('className');
  expect(navigation(await observations(host))).toEqual([]);
  await capture(page, frame(host), 'mv1-updated-literal', info);
});

test('markdown viewer MV2: structural Markdown code tables and read-only tasks', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  const source =
    '# Review heading\n\n**Strong result** and *emphasis*.\n\n> Readable quotation\n\n- Alpha\n- Beta\n\n- [ ] Pending item\n- [x] Finished item\n\n| Item | Count |\n| --- | --- |\n| Apples | 2 |\n\n```ts\nconst literal = "<button>";\n```\n\n<!--anchor:review:start-->Anchored text<!--anchor:review:end-->';
  await toggle(host, 'Supply onCodeBlockAction', true);
  await apply(host, source);
  await expect(viewer(host).getByRole('heading', { level: 1 })).toHaveText('Review heading');
  await expect(viewer(host).locator('strong')).toHaveText('Strong result');
  await expect(viewer(host).locator('em')).toHaveText('emphasis');
  await expect(viewer(host).getByRole('cell')).toHaveText(['Apples', '2']);
  await expect(viewer(host).getByRole('columnheader')).toHaveText(['Item', 'Count']);
  await expect(viewer(host).locator('pre code')).toHaveText('const literal = "<button>";\n');
  await expect(viewer(host).locator('pre button')).toHaveCount(0);
  const checkboxes = viewer(host).getByRole('checkbox');
  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.nth(0)).not.toBeChecked();
  await expect(checkboxes.nth(1)).toBeChecked();
  await expect(checkboxes.nth(0)).toBeDisabled();
  await expect(checkboxes.nth(1)).toBeDisabled();
  await expect(viewer(host).locator('[data-anchor-id="review:start"]')).toHaveCount(1);
  await expect(viewer(host).locator('[data-anchor-id="review:end"]')).toHaveCount(1);
  expect(navigation(await observations(host))).toEqual([]);
  await capture(page, frame(host), 'mv2-structural-markdown', info);

  // The original mixed/loose fixture above stays unchanged: two tasks mean two controls.
  for (const name of ['Alpha', 'Beta']) {
    await expect(
      viewer(host).getByRole('listitem').filter({ hasText: name }).getByRole('checkbox'),
    ).toHaveCount(0);
  }

  await apply(host, '# Replacement heading\n\n| Item | Count |\n| --- | --- |\n| Pears | 7 |');
  await expect(viewer(host).getByRole('cell')).toHaveText(['Pears', '7']);
  await expect(viewer(host).getByRole('checkbox')).toHaveCount(0);
  await expect(viewer(host).locator('[data-anchor-id]')).toHaveCount(0);

  async function assertReadOnlyTasks(checkedStates) {
    const current = viewer(host).getByRole('checkbox');
    await expect(current).toHaveCount(checkedStates.length);
    for (const [index, checked] of checkedStates.entries()) {
      if (checked) await expect(current.nth(index)).toBeChecked();
      else await expect(current.nth(index)).not.toBeChecked();
      await expect(current.nth(index)).toBeDisabled();
    }
    expect(navigation(await observations(host))).toEqual([]);
  }

  await apply(host, '## Tight tasks\n\n- [ ] Tight pending\n- [x] Tight finished');
  await expect(viewer(host).getByRole('heading', { level: 2 })).toHaveText('Tight tasks');
  await assertReadOnlyTasks([false, true]);
  await expect(viewer(host)).toContainText('Tight pending');
  await expect(viewer(host)).toContainText('Tight finished');
  await capture(page, frame(host), 'mv2-tight-tasks', info);

  await apply(host, '## Loose tasks\n\n- [ ] Loose pending\n\n- [x] Loose finished');
  await expect(viewer(host).getByRole('heading', { level: 2 })).toHaveText('Loose tasks');
  await assertReadOnlyTasks([false, true]);
  await expect(viewer(host)).toContainText('Loose pending');
  await expect(viewer(host)).toContainText('Loose finished');
  await capture(page, frame(host), 'mv2-loose-tasks', info);

  await apply(
    host,
    '## Nested tasks\n\n- [ ] Parent pending\n\n  Parent continuation **kept** with [nested note](intent://local/note/spec).\n\n  - [x] Child finished\n\n    Child continuation remains.\n\n  - [ ] Child pending\n\n  - Nested plain item\n\n- [x] Sibling finished',
  );
  await expect(viewer(host).getByRole('heading', { level: 2 })).toHaveText('Nested tasks');
  await assertReadOnlyTasks([false, true, false, true]);
  const parentTask = viewer(host).getByRole('listitem').filter({ hasText: 'Parent pending' });
  await expect(parentTask).toHaveCount(1);
  await expect(parentTask.getByRole('checkbox')).toHaveCount(3);
  await expect(parentTask).toContainText('Child continuation remains.');
  await expect(parentTask).toContainText('Child pending');
  await expect(parentTask.locator('strong')).toHaveText('kept');
  await expect(parentTask.getByRole('link', { name: 'nested note' })).toHaveAttribute(
    'href',
    'intent://local/note/spec',
  );
  const plainChild = parentTask.getByRole('listitem').filter({ hasText: 'Nested plain item' });
  await expect(plainChild).toHaveCount(1);
  await expect(plainChild.getByRole('checkbox')).toHaveCount(0);
  await capture(page, frame(host), 'mv2-nested-task-content', info);
  const oldTask = await parentTask.elementHandle();
  await apply(host, 'All nested task content removed.');
  await expect(viewer(host)).toHaveText('All nested task content removed.');
  await expect(viewer(host).getByRole('checkbox')).toHaveCount(0);
  await detached(oldTask);
  expect(navigation(await observations(host))).toEqual([]);
});

test('markdown viewer MV3: sanitized HTML opt-in keeps dangerous content inert', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  const source =
    '<details><summary>Inspect safe content</summary><p>Visible <strong>safe text</strong>.</p></details>\n\n<script>throw new Error("must remain inert")</script>\n\n<a href="javascript:throw%20new%20Error()" onclick="throw new Error()">Blocked destination</a>\n\n<iframe srcdoc="<script>throw 1</script>"></iframe>';
  await apply(host, source);
  await expect(viewer(host).locator('details,script,iframe')).toHaveCount(0);
  await expect(viewer(host)).toContainText('<details>');
  await choose(host, 'allowSanitizedHtml', 'true');
  const details = viewer(host).locator('details');
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('strong')).toHaveText('safe text');
  await expect(
    viewer(host).locator('script,iframe,[onclick],[onerror],a[href^="javascript:"]'),
  ).toHaveCount(0);
  const before = navigation(await observations(host));
  await viewer(host).getByText('Blocked destination', { exact: true }).click();
  expect(navigation(await observations(host))).toEqual(before);
  await capture(page, frame(host), 'mv3-safe-html', info);
  await choose(host, 'allowSanitizedHtml', 'false');
  await expect(viewer(host).locator('details')).toHaveCount(0);
  await expect(viewer(host)).toContainText('<details>');
});

test('markdown viewer MV6: anchor native event current callback panel and file policy', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await apply(
    host,
    '[Web target](https://example.com/review)\n\n[File target](docs/report.md#L8)\n\n[Note target](intent://local/note/spec)',
  );
  await clear(host);
  const web = viewer(host).getByRole('link', { name: 'Web target' });
  anchorArgs(await activate(host, web), {
    url: 'https://example.com/review',
    rawHref: 'https://example.com/review',
  });
  await field(host, 'Context workspace ID').fill('context-current');
  await field(host, 'Source panel ID').fill('current-panel');
  await button(host, 'Replace onOpenLink').click();
  await choose(host, 'forceExternalLinks', 'true');
  await choose(host, 'canOpenFile', 'false');
  const current = {
    workspace: 'context-current',
    panel: 'current-panel',
    forceExternal: true,
    admission: true,
  };
  anchorArgs(await activate(host, web, { key: 'Control+Enter', revision: 1 }), {
    ...current,
    url: 'https://example.com/review',
    rawHref: 'https://example.com/review',
    key: 'Enter',
    ctrl: true,
  });
  const file = viewer(host).getByRole('link', { name: 'File target' });
  anchorArgs(await activate(host, file, { revision: 1 }), {
    ...current,
    url: new URL('docs/report.md#L8', page.url()).href,
    rawHref: 'docs/report.md#L8',
  });
  const note = viewer(host).getByRole('link', { name: 'Note target' });
  anchorArgs(await activate(host, note, { key: 'Enter', revision: 1 }), {
    ...current,
    url: 'intent://local/note/spec',
    rawHref: 'intent://local/note/spec',
  });
  await toggle(host, 'Supply source panel marker', false);
  await choose(host, 'forceExternalLinks', 'omit');
  await choose(host, 'workspaceContext', 'undefined');
  anchorArgs(await activate(host, web, { revision: 1 }), {
    url: 'https://example.com/review',
    rawHref: 'https://example.com/review',
    workspace: null,
    panel: null,
    admission: true,
  });
  // These are host receipts only; the callback intentionally performs no navigation.
  await capture(page, frame(host), 'mv6-current-link-context', info);
});

test('markdown viewer MV7: file mention callback precedence line policy and context', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await apply(host, 'Read @src/review.ts:12');
  const target = mention(host, 'file', 'src/review.ts');
  await toggle(host, 'Supply onFileClick', true);
  let record = await activate(host, target, { name: 'onFileClick', modifiers: ['Control'] });
  mentionEvent(record, { ctrl: true });
  expect(record.arguments).toEqual([
    'src/review.ts',
    { line: 12, openInAdjacentPanel: true, sourcePanelId: 'markdown-viewer-panel' },
  ]);
  await button(host, 'Replace onFileClick').click();
  record = await activate(host, target, { name: 'onFileClick', revision: 1 });
  mentionEvent(record);
  expect(record.arguments[1].openInAdjacentPanel).toBe(false);
  await toggle(host, 'Supply onFileClick', false);
  await field(host, 'Context workspace ID').fill('current-context');
  await field(host, 'workspaceId override').fill('explicit-workspace');
  await toggle(host, 'Supply workspaceId override', true);
  await button(host, 'Replace onOpenFile').click();
  record = await activate(host, target, { name: 'onOpenFile', revision: 1 });
  mentionEvent(record);
  expect(record.arguments).toEqual([
    'explicit-workspace',
    'src/review.ts',
    { line: 12, openInAdjacentPanel: false, sourcePanelId: 'markdown-viewer-panel' },
  ]);
  await toggle(host, 'Supply workspaceId override', false);
  record = await activate(host, target, { name: 'onOpenFile', revision: 1 });
  expect(record.arguments[0]).toBe('current-context');
  await choose(host, 'canOpenFile', 'false');
  let before = navigation(await observations(host));
  await target.click();
  expect(navigation(await observations(host))).toEqual(before);
  await choose(host, 'canOpenFile', 'omit');
  await choose(host, 'workspaceContext', 'null');
  before = navigation(await observations(host));
  await target.click();
  expect(navigation(await observations(host))).toEqual(before);
  await capture(page, frame(host), 'mv7-file-policy', info);
});

test('markdown viewer MV8: note mentions keep current context despite file denial', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  await apply(host, 'Review @note/spec');
  await choose(host, 'canOpenFile', 'false');
  const target = mention(host, 'note', 'spec');
  let record = await activate(host, target, { name: 'onOpenNote', modifiers: ['Control'] });
  mentionEvent(record, { ctrl: true });
  expect(record.arguments).toEqual([
    'system-design',
    'spec',
    { openInAdjacentPanel: true, sourcePanelId: 'markdown-viewer-panel' },
  ]);
  await button(host, 'Replace onOpenNote').click();
  await field(host, 'Context workspace ID').fill('note-context');
  await field(host, 'Source panel ID').fill('note-panel');
  record = await activate(host, target, { name: 'onOpenNote', revision: 1 });
  mentionEvent(record, { panel: 'note-panel' });
  expect(record.arguments).toEqual([
    'note-context',
    'spec',
    { openInAdjacentPanel: false, sourcePanelId: 'note-panel' },
  ]);
  await choose(host, 'workspaceContext', 'undefined');
  const before = navigation(await observations(host));
  await target.click();
  expect(navigation(await observations(host))).toEqual(before);
  await capture(page, frame(host), 'mv8-note-policy', info);
});

test('markdown viewer MV10: file image admission and real embedded bytes are independent', async ({
  page,
}, info) => {
  const host = await openViewer(page);
  const content = '**Denied source**\n\n![Denied image](intent://local/file/private.png)';
  await choose(host, 'canOpenFile', 'false');
  await choose(host, 'allowFileMedia', 'true');
  await apply(host, content);
  await expect(viewer(host).getByTestId('media-unavailable')).toHaveCount(1);
  await expect(viewer(host).locator('img[src],video,source')).toHaveCount(0);
  await expect(viewer(host).getByRole('button')).toHaveCount(0);
  await choose(host, 'allowFileMedia', 'false');
  await choose(host, 'canOpenFile', 'omit');
  const { image } = await insertImage(page, host);
  await expect(image).toHaveAttribute('role', 'button');
  await expect(viewer(host).getByTestId('media-unavailable')).toHaveCount(1);
  // Establish the source's hovered image state before the strict capture probe.
  await image.hover();
  const options = imageActions(host);
  await expect(options).toBeVisible();
  await expect(options).toHaveAttribute('aria-haspopup', 'menu');
  await expect(options).toHaveAttribute('aria-expanded', 'false');
  const hovered = {
    aria: await frame(host).ariaSnapshot(),
    image: await image.boundingBox(),
    options: await options.boundingBox(),
  };
  await info.attach('mv10-hover-setup.json', {
    body: JSON.stringify(hovered, null, 2),
    contentType: 'application/json',
  });
  // The source positions image actions inside the image; keep the control usable there.
  expect(hovered.image).not.toBeNull();
  expect(hovered.options).not.toBeNull();
  expect(hovered.options.x).toBeGreaterThanOrEqual(hovered.image.x);
  expect(hovered.options.y).toBeGreaterThanOrEqual(hovered.image.y);
  expect(hovered.options.x + hovered.options.width).toBeLessThanOrEqual(
    hovered.image.x + hovered.image.width,
  );
  expect(hovered.options.y + hovered.options.height).toBeLessThanOrEqual(
    hovered.image.y + hovered.image.height,
  );
  await capture(page, frame(host), 'mv10-file-denied-bytes-admitted', info);
  const previous = await image.elementHandle();
  await apply(host, '**Removed media**');
  await expect(viewer(host).locator('img')).toHaveCount(0);
  await detached(previous);
  // Unchanged network guard rejects any attempted workspace or remote read.
});

test('markdown viewer MV12: native image focus lightbox context menu and clipboard paste', async ({
  page,
  context,
}, info) => {
  const host = await openViewer(page);
  await apply(host, '');
  const { image, src, file } = await insertImage(page, host);
  await tabTo(page, host, image);
  await expect(image).toBeFocused();
  await image.press('Enter');
  const dialog = page.getByRole('dialog', { name: label('ui_imageLightbox_preview_ariaLabel') });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveAttribute('src', src);
  await capture(page, dialog, 'mv12-image-lightbox', info);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  await image.press('Space');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await image.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('image-info-dimensions')).toHaveText(
    label('ui_imageActionsMenu_dimensions_label', { width: file.width, height: file.height }),
  );
  await capture(page, menu, 'mv12-native-image-menu', info);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  await menu
    .getByRole('menuitem', { name: label('ui_imageActionsMenu_copyImage_label'), exact: true })
    .click();
  await expect(menu).toHaveCount(0);
  await expect(
    page.getByText(label('ui_imageActionsMenu_imageCopied_label'), { exact: true }),
  ).toBeVisible();
  await field(host, 'Paste copied image here').press('Control+V');
  const receipts = field(host, 'Markdown clipboard receipts');
  await expect
    .poll(async () => JSON.parse(await receipts.textContent())[0]?.files[0]?.dataUrl ?? null)
    .toMatch(/^data:image\/png;base64,/);
  const paste = JSON.parse(await receipts.textContent())[0];
  const decoded = assertPastedPng(paste, file);
  await info.attach('mv12-native-clipboard.json', {
    body: JSON.stringify({ paste, decoded }, null, 2),
    contentType: 'application/json',
  });
  expect(navigation(await observations(host))).toEqual([]);
});
