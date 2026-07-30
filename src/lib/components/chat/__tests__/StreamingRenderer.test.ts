/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import StreamingRenderer from '../StreamingRenderer.svelte';

afterEach(cleanup);

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderStreaming(content: string): Promise<string> {
  const { container } = render(StreamingRenderer, { props: { content, isActive: true } });
  await nextFrame();
  await nextFrame();
  const el = container.querySelector('.streaming-content');
  return el ? el.innerHTML : '';
}

describe('StreamingRenderer whitelisted inline tags (br/sub/sup)', () => {
  it('keeps <br/> inside inline code literal', async () => {
    const html = await renderStreaming('Use `<br/>` in HTML');
    expect(html).toContain('<code class="inline-code">&lt;br/&gt;</code>');
  });

  it('keeps <sub>/<sup> inside inline code literal', async () => {
    const html = await renderStreaming('Use `<sub>` and `</sup>` in HTML');
    expect(html).toContain('<code class="inline-code">&lt;sub&gt;</code>');
    expect(html).toContain('<code class="inline-code">&lt;/sup&gt;</code>');
  });

  it('renders bare <br> outside code as a real tag', async () => {
    const html = await renderStreaming('line one<br>line two');
    expect(html).toContain('line one<br>line two');
  });

  it('renders <br/>, <br /> and sub/sup outside code as real tags', async () => {
    const html = await renderStreaming('a<br/>b<br />c H<sub>2</sub>O x<sup>2</sup>');
    expect(html).toMatch(/a<br\/?>b/);
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
  });

  it('keeps whitelisted tags literal inside fenced code blocks', async () => {
    const html = await renderStreaming('```html\nline<br>H<sub>2</sub>O\n```\ndone');
    expect(html).toContain('&lt;br&gt;');
    expect(html).toContain('&lt;sub&gt;');
  });

  it('keeps non-whitelisted tags escaped outside code', async () => {
    const html = await renderStreaming('a <div> b <br class="x"> c');
    expect(html).toContain('&lt;div&gt;');
    expect(html).toContain('&lt;br class="x"&gt;');
  });
});
