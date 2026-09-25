import { afterEach, describe, expect, it, vi } from 'vitest';
import { addMermaidLabelKnockouts } from '../mermaid-label-knockouts';

function fixture() {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
    <text class="messageText" id="message">Reply</text>
    <g class="edgeLabel"><title>Edge</title><text id="edge">Continue</text></g>
    <g class="edgeLabel"><text id="empty-edge"></text></g>
    <g class="edgeLabel"><rect class="background"/><text id="background">Kept</text></g>
    <g class="edgeLabel"><foreignObject/><text id="html">Kept</text></g>
    <g class="edgeLabel"><rect class="edge-label-knockout"/><text id="existing">Kept</text></g>
    <g class="edgeLabel"><path/></g>
    <text class="loopText" id="loop">Repeat</text>
    <text class="messageText" id="empty"> </text>
    <text class="messageText" id="marked" data-label-knockout="true">Kept</text>
    <text id="unrelated">Unrelated</text>
  </svg>`;
  document.body.append(host);
  const svg = host.querySelector('svg')!;
  const events: string[] = [];
  const reads = new Map<string, ReturnType<typeof vi.fn>>();
  for (const text of svg.querySelectorAll('text')) {
    const read = vi.fn(() => {
      events.push(`read:${text.id}`);
      // jsdom has no SVG layout. These values are not a geometry oracle;
      // real fonts/offsets and padded paint are covered in the browser suite.
      return { x: 10, y: -8, width: 40, height: 16 };
    });
    Object.defineProperty(text, 'getBBox', { value: read });
    reads.set(text.id, read);
  }
  const insertBefore = Node.prototype.insertBefore;
  vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function (node, before) {
    events.push(`insert:${before instanceof Element ? before.id || before.tagName : ''}`);
    return insertBefore.call(this, node, before);
  });
  return { svg, events, reads };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('addMermaidLabelKnockouts', () => {
  it('finishes all independent edge and sequence measurements before insertion', () => {
    const { svg, events } = fixture();
    addMermaidLabelKnockouts(svg);
    const firstInsertion = events.findIndex((event) => event.startsWith('insert:'));
    expect(events.slice(firstInsertion).filter((event) => event.startsWith('read:'))).toEqual([]);
    expect(events.filter((event) => event.startsWith('read:'))).toEqual([
      'read:edge',
      'read:empty-edge',
      'read:message',
      'read:loop',
    ]);
  });

  it('preserves insertion order, ownership, skipped surfaces and repeat-call idempotency', () => {
    const { svg, events, reads } = fixture();
    const originalChildren = [...svg.querySelectorAll('*')].map((node) => ({
      node,
      children: [...node.childNodes],
    }));
    addMermaidLabelKnockouts(svg);
    expect(events.filter((event) => event.startsWith('insert:'))).toEqual([
      'insert:title',
      'insert:empty-edge',
      'insert:message',
      'insert:loop',
    ]);
    for (const { node, children } of originalChildren) {
      expect([...node.childNodes].filter((child) => children.includes(child))).toEqual(children);
    }
    for (const id of ['background', 'html', 'existing', 'empty', 'marked', 'unrelated']) {
      expect(reads.get(id)).not.toHaveBeenCalled();
    }
    expect(svg.querySelector('#message')?.previousElementSibling?.tagName).toBe('rect');
    expect(svg.querySelector('#loop')?.previousElementSibling?.tagName).toBe('rect');
    expect(svg.querySelector('#edge')?.parentElement?.firstElementChild?.tagName).toBe('rect');
    const once = svg.outerHTML;
    events.length = 0;
    addMermaidLabelKnockouts(svg);
    expect(svg.outerHTML).toBe(once);
    expect(events).toEqual([]);
  });
});
