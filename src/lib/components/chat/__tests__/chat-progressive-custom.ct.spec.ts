import { expect, test } from '../../../../test/ct-test';
import StreamingMessageContent from '../StreamingMessageContent.svelte';

const prefix =
  JSON.stringify({
    id: '10000000-0000-4000-8000-000000000001',
    type: 'diagram',
    version: 1,
    createdAt: '2026-09-22T00:00:00.000Z',
    createdBy: 'agent',
    grammar: 'flowchart',
    baseView: { layout: { type: 'layered', direction: 'LR' } },
  }).slice(0, -1) + ',"model":{"nodes":[';

for (const language of ['diagram', 'ws-block:diagram']) {
  test(`chat ${language} grows before root JSON closure and validates unchanged final source`, async ({
    mount,
  }) => {
    const content = (source: string, closed = false) => [
      {
        type: 'text' as const,
        text: `A custom diagram is arriving.\n~~~${language}\n${source}${closed ? '\n~~~\nThe next paragraph remains visible.' : ''}`,
      },
    ];
    const first = prefix + '{"id":"a","label":"Draft"},';
    const component = await mount(StreamingMessageContent, {
      props: { content: content(first), isStreaming: true },
    });
    const renderer = component.locator('.diagram-renderer');
    await expect(component.locator('[data-node-id="a"]')).toBeVisible();
    await renderer.evaluate((el) => el.setAttribute('data-instance-proof', 'same'));
    const second = first + '{"id":"b","label":"Review"}],"edges":[';
    await component.update({ props: { content: content(second), isStreaming: true } });
    await expect(component.locator('[data-node-id="b"]')).toBeVisible();
    await expect(renderer).toHaveAttribute('data-instance-proof', 'same');
    const partialEdge = second + '{"id":"e","from":"a","to":';
    await component.update({ props: { content: content(partialEdge), isStreaming: true } });
    await expect(component.locator('[data-node-id]')).toHaveCount(2);
    await expect(component.getByRole('alert')).toHaveCount(0);
    const complete = partialEdge + '"b"}]}}';
    await component.update({ props: { content: content(complete, true), isStreaming: true } });
    await expect(component.getByText('The next paragraph remains visible.')).toBeVisible();
    await expect(renderer).toHaveAttribute('data-instance-proof', 'same');
    await expect(component.getByRole('alert')).toHaveCount(0);
    await component.update({ props: { content: content(partialEdge), isStreaming: true } });
    await expect(component.locator('[data-node-id]')).toHaveCount(2);
    await component.update({ props: { content: content(partialEdge), isStreaming: false } });
    await expect(component.getByRole('alert')).toBeVisible();
    await expect(component.locator('.diagram-renderer')).toHaveCount(0);
    await expect(component.locator('.diagram-source')).toHaveText(partialEdge);
  });
}
