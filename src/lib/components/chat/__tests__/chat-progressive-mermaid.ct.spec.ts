import { expect, test } from '../../../../test/ct-test';
import StreamingMessageContent from '../StreamingMessageContent.svelte';

const examples = [
  {
    name: 'flowchart',
    first: 'flowchart LR\n A[Draft] --> B[Review]',
    partial: '\n B --> C[Rele',
    rest: 'ase]',
  },
  {
    name: 'sequence',
    first: 'sequenceDiagram\n A->>B: Start',
    partial: '\n loop Waiting\n A->>B: Again',
    rest: '\n end\n B->>A: Ready',
  },
  {
    name: 'state',
    first: 'stateDiagram-v2\n [*] --> Idle',
    partial: '\n state Work {',
    rest: '\n [*] --> Busy\n }\n Idle --> Work',
  },
  {
    name: 'class',
    first: 'classDiagram\n class A',
    partial: '\n class B {\n +string',
    rest: ' name\n }\n A --> B',
  },
  {
    name: 'entity relationship',
    first: 'erDiagram\n A ||--o{ B : owns',
    partial: '\n B {\n string',
    rest: ' id\n }\n B ||--o{ C : has',
  },
];
const content = (source: string, close = false) => [
  {
    type: 'text' as const,
    text: `Here is the evolving diagram.\n\n~~~mermaid\n${source}${close ? '\n~~~\n\nThe explanation continues after the diagram.' : ''}`,
  },
];

for (const example of examples) {
  test(`progressive Mermaid ${example.name} paints twice before closure and retains incomplete paint`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 720, height: 800 });
    const component = await mount(StreamingMessageContent, {
      props: { content: content(example.first), isStreaming: true },
    });
    const renderer = component.locator('.mermaid-renderer');
    const svg = component.locator('.mermaid-svg svg');
    await expect(renderer).toHaveAttribute('data-render-settled', 'true');
    await expect(svg).toHaveCount(1);
    const firstPaint = await svg.evaluate((el) => el.outerHTML);
    await renderer.evaluate((el) => {
      el.setAttribute('data-instance-proof', 'same');
    });
    if (example.name === 'flowchart') {
      await testInfo.attach('first-open-fence-paint', {
        body: await component.screenshot(),
        contentType: 'image/png',
      });
    }
    const generation = Number(await renderer.getAttribute('data-render-generation'));
    await component.update({
      props: { content: content(example.first + example.partial), isStreaming: true },
    });
    await expect
      .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
      .toBeGreaterThan(generation);
    await expect(renderer).toHaveAttribute('data-render-settled', 'true');
    await expect(component.getByRole('alert')).toHaveCount(0);
    await expect(svg).toHaveCount(1);
    expect(await svg.evaluate((el) => el.outerHTML)).toBe(firstPaint);
    const completed = example.first + example.partial + example.rest;
    await component.update({ props: { content: content(completed), isStreaming: true } });
    await expect.poll(async () => svg.evaluate((el) => el.outerHTML)).not.toBe(firstPaint);
    await expect(renderer).toHaveAttribute('data-render-settled', 'true');
    await expect(renderer).toHaveAttribute('data-instance-proof', 'same');
    await expect(component.getByRole('alert')).toHaveCount(0);
    if (example.name === 'flowchart') {
      await testInfo.attach('second-open-fence-paint', {
        body: await component.screenshot(),
        contentType: 'image/png',
      });
    }
    const beforeClose = Number(await renderer.getAttribute('data-render-generation'));
    await component.update({ props: { content: content(completed, true), isStreaming: true } });
    await expect
      .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
      .toBeGreaterThan(beforeClose);
    await expect(renderer).toHaveAttribute('data-render-settled', 'true');
    await expect(component.getByText('The explanation continues after the diagram.')).toBeVisible();
    await expect(renderer).toHaveAttribute('data-instance-proof', 'same');
    await expect(svg).toHaveCount(1);
  });
}

test('stream end validates unchanged invalid Mermaid and exposes source rather than stale success', async ({
  mount,
}) => {
  const first = 'flowchart LR\n A --> B';
  const component = await mount(StreamingMessageContent, {
    props: { content: content(first), isStreaming: true },
  });
  const renderer = component.locator('.mermaid-renderer');
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  const invalid = first + '\n B --> C[Unfinished';
  const generation = Number(await renderer.getAttribute('data-render-generation'));
  await component.update({ props: { content: content(invalid), isStreaming: true } });
  await expect
    .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
    .toBeGreaterThan(generation);
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  await expect(component.locator('.mermaid-svg svg')).toHaveCount(1);
  await expect(component.getByRole('alert')).toHaveCount(0);
  await component.update({ props: { content: content(invalid), isStreaming: false } });
  await expect(component.getByRole('alert')).toBeVisible();
  await expect(component.locator('.mermaid-svg svg')).toHaveCount(0);
  await component.getByText('Technical details').click();
  await expect(component.locator('.error-source-code')).toHaveText(invalid);
});
