import {
  test,
  openInline,
  captureInline,
  exercise,
  field,
  limit,
  expectInline,
  applyIcon,
  expectArtwork,
  expectInitial,
  iconGeometry,
} from '../lib/chat-inline.mjs';

test('chat inline M1: native input preserves strong emphasis code and inert link text', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'markdown');
  await expectInline(item, 'strong emphasis code readable label & *literal*', [
    ['strong', 'strong'],
    ['em', 'emphasis'],
    ['code', 'code'],
  ]);
  await captureInline(page, item.frame, 'semantics-before', info);
  const tick = String.fromCharCode(96);
  await field(item.section, 'Markdown content').fill(
    '**Current** _emphasis_ ' +
      tick +
      '<literal>&' +
      tick +
      ' [destination](https://example.com) &amp; \\*plain\\*',
  );
  await expectInline(item, 'Current emphasis <literal>& destination & *plain*', [
    ['strong', 'Current'],
    ['em', 'emphasis'],
    ['code', '<literal>&'],
  ]);
  await captureInline(page, item.frame, 'semantics-after', info);
});

test('chat inline M2: media code blocks and tables are omitted without fetching media', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'markdown');
  await captureInline(page, item.frame, 'omissions-before', info);
  const fence = String.fromCharCode(96).repeat(3);
  await field(item.section, 'Markdown content').fill(
    [
      'Before',
      '![omitted picture](https://example.com/inline-omitted.png)',
      fence + 'js\nconst omitted = "code block";\n' + fence,
      '| hidden table |\n| --- |\n| hidden cell |',
      '**After**',
    ].join('\n\n'),
  );
  await expectInline(item, 'Before After', [['strong', 'After']]);
  await captureInline(page, item.frame, 'omissions-after', info);
  // The unchanged strict network guard also rejects any external image fetch.
});

test('chat inline M3: graphemes limits zero fractions defaults and empty input remain exact', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'markdown');
  await captureInline(page, item.frame, 'limits-before', info);
  const input = field(item.section, 'Markdown content');
  await input.fill('A👩🏽‍💻e\u0301🇳🇿Z');
  await limit(item).fill('3');
  await expectInline(item, 'A👩🏽‍💻e\u0301…');
  await limit(item).fill('4.9');
  await expectInline(item, 'A👩🏽‍💻e\u0301🇳🇿…');
  await limit(item).fill('5');
  await expectInline(item, 'A👩🏽‍💻e\u0301🇳🇿Z');
  for (const value of ['0', '-2']) {
    await limit(item).fill(value);
    await expectInline(item, '…');
  }
  await input.fill('');
  await expectInline(item, '');
  await input.fill(' \n\t ');
  await expectInline(item, '');
  await limit(item).fill('');
  await input.fill('x'.repeat(81));
  await expectInline(item, 'x'.repeat(80) + '…');
  await input.fill('**ABCD**');
  await limit(item).fill('2');
  await expectInline(item, 'AB…', [['strong', 'AB…']]);
  await captureInline(page, item.frame, 'limits-after', info);
});

test('chat inline I1: both original inline logos preserve artwork and case-insensitive selection', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'mcp');
  await expectArtwork(item, 'context7', info);
  await iconGeometry(item, 20, info, 'inline-default');
  await captureInline(page, item.frame, 'inline-logos-before', info);
  await applyIcon(item, 'SLACK', 'Enter');
  await expectArtwork(item, 'slack', info);
  await captureInline(page, item.frame, 'inline-slack', info);
  await applyIcon(item, 'CoNtExT7', 'Space');
  await expectArtwork(item, 'context7', info);
  await captureInline(page, item.frame, 'inline-logos-after', info);
});

test('chat inline I2: all five local fallback names use original resolved artwork and decorative accessibility', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'mcp');
  await captureInline(page, item.frame, 'fallback-art-before', info);
  for (const name of ['brain', 'server', 'database', 'cloud', 'default']) {
    await applyIcon(item, name.toUpperCase());
    await expectArtwork(item, name, info);
    await iconGeometry(item, 20, info, 'fallback-' + name);
    await captureInline(page, item.frame, 'fallback-' + name, info);
  }
});

test('chat inline I3: unknown and whitespace names show the current literal initial and support empty labels', async ({
  page,
}, info) => {
  const item = exercise(await openInline(page), 'mcp');
  await captureInline(page, item.frame, 'initial-before', info);
  await field(item.section, 'Icon label').fill('beta');
  await applyIcon(item, 'catalog-unknown');
  await expectInitial(item, 'b');
  await field(item.section, 'Icon label').fill('雪 server');
  await expectInitial(item, '雪');
  await iconGeometry(item, 20, info, 'initial-readable');
  await captureInline(page, item.frame, 'initial-unicode', info);
  // Source lowercases names but does not trim them or uppercase initials.
  await applyIcon(item, ' brain ');
  await expectInitial(item, '雪');
  await field(item.section, 'Icon label').fill('');
  await expectInitial(item, '');
  await field(item.section, 'Icon label').fill('Current server');
  await applyIcon(item, '');
  await expectInitial(item, 'C');
  await captureInline(page, item.frame, 'initial-after', info);
});
