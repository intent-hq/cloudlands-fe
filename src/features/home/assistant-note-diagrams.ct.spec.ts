import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../test/ct-test';
import Preview from './assistant-panels.preview.svelte';
import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
import RenderedNotePreview from '$features/layout/tab-types/RenderedNotePreview.svelte';
import {
  ASSISTANT_DIAGRAM_ERROR_NOTE,
  ASSISTANT_DIAGRAM_EXAMPLE_NOTE,
  ASSISTANT_DIAGRAM_NOTE,
  ASSISTANT_MERMAID_SOURCE,
  ASSISTANT_NATIVE_DIAGRAM,
} from './assistant-note-diagrams-fixtures';

async function selectRenderedPreview(panel: Locator, page: Page) {
  await expect(
    panel.locator('.tiptap[contenteditable="true"]').filter({ visible: true }),
  ).toBeVisible();
  await panel.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: /^Note view/ }).press('ArrowRight');
  await page.getByRole('menuitemradio', { name: 'Rendered preview', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

test('Assistant note diagrams render, expose source, export and follow note links', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const component = await mount(Preview, { props: { noteContent: ASSISTANT_DIAGRAM_NOTE } });
  const draft = component.getByRole('textbox', { name: 'Message the Assistant' });
  await draft.fill('Keep this diagram discussion');
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await selectRenderedPreview(panel, page);
  const note = component.locator('[data-testid="rendered-note-preview"]:visible');
  const mermaid = note.locator('[data-markdown-diagram="mermaid"]');
  const native = note.locator('[data-markdown-diagram="diagram"]');
  await expect(mermaid.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true');
  await expect(native.locator('[data-diagram-settled]')).toHaveAttribute(
    'data-diagram-settled',
    'true',
  );
  await expect(mermaid.locator('.mermaid-svg > svg')).toContainText('Intent daemon');
  await expect(native.locator('.diagram-svg-layer')).toContainText('Architecture notes α');
  await expect(note.getByRole('table')).toContainText('Durable work');
  await mermaid.locator('.mermaid-svg-container').hover();
  await mermaid.getByRole('button', { name: 'View source' }).click();
  await expect(mermaid.getByRole('region', { name: 'View source' })).toHaveText(
    ASSISTANT_MERMAID_SOURCE,
  );
  await mermaid.getByRole('button', { name: 'View source' }).click();
  const fullscreen = mermaid.getByRole('button', { name: /[Ff]ullscreen|[Ee]xpand/ });
  await fullscreen.focus();
  await fullscreen.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Intent daemon');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(mermaid.locator('[data-diagram-presentation]')).toHaveAttribute(
    'data-diagram-presentation-settled',
    'true',
  );
  await mermaid.getByRole('button', { name: 'Diagram actions', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Download SVG/ }).click();
  const svg = await download;
  expect(svg.suggestedFilename()).toMatch(/\.svg$/);
  await svg.saveAs(testInfo.outputPath('assistant-note-diagram.svg'));
  await testInfo.attach('assistant-note-diagram.svg', {
    path: testInfo.outputPath('assistant-note-diagram.svg'),
    contentType: 'image/svg+xml',
  });
  await testInfo.attach('assistant-diagrams', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await native.getByRole('button', { name: /Architecture notes α/ }).click();
  await selectRenderedPreview(panel, page);
  await expect(note).toContainText('Second plan');
  await expect(note.locator('[data-markdown-diagram]')).toHaveCount(0);
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await expect(note.locator('[data-markdown-diagram]')).toHaveCount(2);
  await expect(draft).toHaveValue('Keep this diagram discussion');
});

test('Assistant diagram errors keep source and surrounding content', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { noteContent: ASSISTANT_DIAGRAM_ERROR_NOTE } });
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await selectRenderedPreview(component.locator('[data-assistant-content-panel]'), page);
  const note = component.getByTestId('rendered-note-preview');
  await expect(note.getByRole('alert')).toHaveCount(3);
  await expect(note).toContainText('End of the error note.');
  await expect(note.locator('[data-markdown-diagram="diagram"] pre').first()).toContainText(
    '{"model":',
  );
  await testInfo.attach('assistant-diagram-errors', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Assistant notes keep fenced examples, code and task proposals literal', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, {
    props: { noteContent: ASSISTANT_DIAGRAM_EXAMPLE_NOTE },
  });
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await selectRenderedPreview(component.locator('[data-assistant-content-panel]'), page);
  const note = component.getByTestId('rendered-note-preview');
  await expect(note.locator('pre code.language-markdown')).toContainText('Example --> Code');
  await expect(note.locator('pre code.language-javascript')).toContainText('const diagram');
  await expect(note.locator('pre code.language-diff')).toContainText('+new');
  await expect(note).toContainText('Task details stay in the note.');
  await expect(note.locator('[data-markdown-diagram]')).toHaveCount(0);
});

test('read-only Markdown replaces diagram source and retains ordinary Markdown', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  const content = [
    '# Intent architecture',
    'Main code layers.',
    `\`\`\`mermaid\n${ASSISTANT_MERMAID_SOURCE}\n\`\`\``,
    '| Part | Responsibility |\n| --- | --- |\n| Renderer | Product UI |',
    '[Documentation][docs]\n\n[docs]: https://example.com/architecture',
  ].join('\n\n');
  const props = { content, workspaceId: 'chief', renderRichFencesAsCode: true };
  const component = await mount(MarkdownViewer, { props });
  await expect(component.locator('pre code.language-mermaid')).toContainText('Intent daemon');
  await testInfo.attach('assistant-note-before', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await component.update({ props: { ...props, renderDiagrams: true } });
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  await expect(component.getByRole('table')).toContainText('Product UI');
  await expect(component.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
    'href',
    'https://example.com/architecture',
  );
  await testInfo.attach('assistant-note-after', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await component.update({ props: { ...props, renderDiagrams: false } });
  await expect(component.locator('pre code.language-mermaid')).toContainText('Intent daemon');
  await expect(component.locator('[data-markdown-diagram]')).toHaveCount(0);
});

test('note updates remove stale diagrams and their fullscreen views', async ({ mount, page }) => {
  const props = {
    content: ASSISTANT_DIAGRAM_NOTE,
    workspaceId: 'chief',
    noteId: 'plan',
    scrollKey: 'plan',
  };
  const component = await mount(RenderedNotePreview, { props });
  const mermaid = component.locator('[data-markdown-diagram="mermaid"]');
  await expect(mermaid.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true');
  const fullscreen = mermaid.getByRole('button', { name: /[Ff]ullscreen|[Ee]xpand/ });
  await fullscreen.focus();
  await fullscreen.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await component.update({
    props: { ...props, content: '## Replacement note\n\nThe old diagrams are gone.' },
  });
  await expect(component).toContainText('The old diagrams are gone.');
  await expect(component.locator('[data-markdown-diagram]')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await component.update({
    props: {
      ...props,
      content: '~~~mermaid\nflowchart LR\n  New[Updated architecture] --> Notes[New notes]\n~~~',
    },
  });
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  await expect(component.locator('.mermaid-svg > svg')).toContainText('Updated architecture');
  await expect(component.locator('.mermaid-svg > svg')).not.toContainText('Intent daemon');
});

test('incomplete diagram JSON keeps its source while the note is being written', async ({
  mount,
}) => {
  const component = await mount(RenderedNotePreview, {
    props: {
      content: '```diagram\n{"model":',
      workspaceId: 'chief',
      noteId: 'plan',
      scrollKey: 'plan',
    },
  });
  await expect(component.getByRole('alert')).toHaveCount(1);
  await expect(component.locator('[data-markdown-diagram] pre')).toHaveText('{"model":');
});

for (const language of ['diagram', 'ws-block:diagram', 'ws-block']) {
  test(`Assistant renders indented ${language} fences on a narrow panel`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 600, height: 1000 });
    const content = `## Native diagram\n\n  \`\`\`${language}\n${JSON.stringify(ASSISTANT_NATIVE_DIAGRAM)}\n  \`\`\`\n\nAfter the diagram.`;
    const component = await mount(Preview, { props: { noteContent: content } });
    await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
    await selectRenderedPreview(component.locator('[data-assistant-content-panel]'), page);
    const note = component.getByTestId('rendered-note-preview');
    await expect(note.locator('[data-diagram-settled]')).toHaveAttribute(
      'data-diagram-settled',
      'true',
    );
    await expect(note).toContainText('After the diagram.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await testInfo.attach(`assistant-${language.replace(':', '-')}-narrow`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
