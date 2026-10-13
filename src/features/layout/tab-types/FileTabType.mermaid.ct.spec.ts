import { expect, test } from '../../../test/ct-test';
import MarkdownFileTabHarness from './__tests__/MarkdownFileTabHarness.svelte';

const source =
  'flowchart TD\n    A["Start"] --> B{"Decision"}\n    B -->|"yes"| C["Done"]\n    B -->|"no"| A';
const content = `# Workflow\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nAfter the diagram.`;

test('Markdown file preview renders Mermaid and preserves its source without editing the file', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(MarkdownFileTabHarness, { props: { content } });
  await expect(component.getByRole('heading', { name: 'Workflow' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('file-preview.png') });
  const diagram = component.locator('[data-markdown-diagram="mermaid"]');
  await expect(diagram.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true');
  await expect(diagram.locator('.mermaid-svg > svg')).toContainText('Decision');
  await expect(component).toContainText('After the diagram.');
  await diagram.locator('.mermaid-svg-container').hover();
  await diagram.getByRole('button', { name: 'View source' }).click();
  await expect(diagram.getByRole('region', { name: 'View source' })).toHaveText(source);
  await expect(component.getByTestId('header-state')).toHaveAttribute('data-dirty', 'false');
  await page.screenshot({ path: testInfo.outputPath('file-diagram-source.png') });

  await component.update({ props: { content: '# Replacement\n\nNo diagram remains.' } });
  await expect(component.getByRole('heading', { name: 'Replacement' })).toBeVisible();
  await expect(component.locator('[data-markdown-diagram]')).toHaveCount(0);
});

test('Markdown file preview keeps malformed Mermaid and fenced examples readable', async ({
  mount,
}) => {
  const component = await mount(MarkdownFileTabHarness, {
    props: {
      content:
        '# Invalid diagram\n\n```mermaid\nnot a diagram\n```\n\n````markdown\n```mermaid\nflowchart LR\nA --> B\n```\n````\n\n```diff\n-old\n+new\n```\n\nStill readable.',
    },
  });
  const diagram = component.locator('[data-markdown-diagram="mermaid"]');
  await expect(diagram.getByRole('alert')).toBeVisible();
  await expect(diagram).toContainText('not a diagram');
  await expect(component.locator('pre code.language-markdown')).toContainText('A --> B');
  await expect(component.locator('pre code.language-diff')).toContainText('+new');
  await expect(component).toContainText('Still readable.');
  await expect(component.locator('[data-markdown-diagram]')).toHaveCount(1);
});
