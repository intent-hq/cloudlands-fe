import {
  test,
  expect,
  openInline,
  captureInline,
  exercise,
  field,
  numberField,
  button,
  markdown,
  limit,
  icon,
  mount,
  expectInline,
  applyIcon,
  expectArtwork,
  expectInitial,
  iconGeometry,
} from '../lib/chat-inline.mjs';

test('chat inline M4: hostile HTML remains literal and paragraph breaks update inert text', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'markdown');
  await captureInline(page, item.frame, 'literal-before', info);
  await limit(item).fill('500');
  const text = '<script>alert("inert")</script> <b onclick="alert(1)">literal</b>';
  await field(item.section, 'Markdown content').fill(text);
  await expectInline(item, text);
  await captureInline(page, item.frame, 'literal-html', info);
  await field(item.section, 'Markdown content').fill(
    '# Heading\n\nFirst<br>second\n\n- third\n- fourth',
  );
  await expectInline(item, 'Heading First second third fourth');
  await captureInline(page, item.frame, 'literal-after', info);
});

test('chat inline M5: genuine worker rendering current updates and native owner replacement stay current', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'markdown');
  await captureInline(page, item.frame, 'worker-before', info);
  const old = await markdown(item).elementHandle();
  try {
    const input = field(item.section, 'Markdown content');
    await input.fill('W'.repeat(6001));
    await expectInline(item, 'W'.repeat(80) + '…');
    const workers = page.workers().map((worker) => worker.url());
    await info.attach('worker-urls.json', {
      body: JSON.stringify(workers, null, 2),
      contentType: 'application/json',
    });
    expect(workers.some((url) => url.includes('markdown-worker'))).toBe(true);
    await captureInline(page, item.frame, 'worker-rendered', info);
    // Successive native caller edits do not prove an older promise was pending.
    await input.fill('**Previous** content');
    await input.fill('Current **日本語**');
    await expectInline(item, 'Current 日本語', [['strong', '日本語']]);
    expect(await old.evaluate((node) => node.isConnected)).toBe(true);
    await mount(item, 'Inline Markdown', false);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await input.fill('_After unmount_');
    await mount(item, 'Inline Markdown', true);
    await expectInline(item, 'After unmount', [['em', 'After unmount']]);
    const mounted = await markdown(item).elementHandle();
    try {
      await button(item.section, 'Remount Inline Markdown').press('Enter');
      expect(await mounted.evaluate((node) => node.isConnected)).toBe(false);
      await expectInline(item, 'After unmount', [['em', 'After unmount']]);
      await captureInline(page, item.frame, 'worker-lifetime-after', info);
    } finally {
      await mounted.dispose();
    }
  } finally {
    await old.dispose();
  }
});

test('chat inline I4: size props allocate contained artwork and readable initials across branches', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'mcp');
  await captureInline(page, item.frame, 'size-before', info);
  await iconGeometry(item, 20, info, 'size-default');
  await numberField(item.section, 'Icon size, blank for default').fill('32');
  await expectArtwork(item, 'context7', info);
  await iconGeometry(item, 32, info, 'size-inline');
  await applyIcon(item, 'brain');
  await expectArtwork(item, 'brain', info);
  await iconGeometry(item, 32, info, 'size-local');
  await field(item.section, 'Icon label').fill('Current');
  await applyIcon(item, 'catalog-unknown');
  await expectInitial(item, 'C');
  await iconGeometry(item, 32, info, 'size-initial');
  await numberField(item.section, 'Icon size, blank for default').fill('');
  await iconGeometry(item, 20, info, 'size-restored');
  await captureInline(page, item.frame, 'size-after', info);
});

test('chat inline I5: native keyboard changes mount and remount the icon with current caller props', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'mcp');
  await captureInline(page, item.frame, 'owner-before', info);
  const old = await icon(item).elementHandle();
  try {
    const name = field(item.section, 'Icon name');
    await name.fill('brain');
    await name.press('Tab');
    await expect(button(item.section, 'Apply icon name')).toBeFocused();
    await page.keyboard.press('Enter');
    await expectArtwork(item, 'brain', info);
    expect(await old.evaluate((node) => node.isConnected)).toBe(true);
    await applyIcon(item, 'slack', 'Space');
    await expectArtwork(item, 'slack', info);
    expect(await old.evaluate((node) => node.isConnected)).toBe(true);
    await mount(item, 'MCP icon', false);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await field(item.section, 'Icon label').fill('Replaced owner');
    await applyIcon(item, 'catalog-unknown', 'Enter');
    await mount(item, 'MCP icon', true);
    await expectInitial(item, 'R');
    const mounted = await icon(item).elementHandle();
    try {
      await button(item.section, 'Remount MCP icon').press('Space');
      expect(await mounted.evaluate((node) => node.isConnected)).toBe(false);
      await expectInitial(item, 'R');
      await applyIcon(item, 'context7', 'Enter');
      await expectArtwork(item, 'context7', info);
      await captureInline(page, item.frame, 'owner-after', info);
    } finally {
      await mounted.dispose();
    }
  } finally {
    await old.dispose();
  }
});
