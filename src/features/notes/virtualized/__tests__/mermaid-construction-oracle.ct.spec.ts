import { expect, test } from '../../../../test/ct-test';
import MermaidBlockLaneHarness from '$lib/components/tiptap/__tests__/MermaidBlockLaneHarness.svelte';

// Native construction oracle, deliberately NOT a bounded production adapter.
// It establishes what a future indexed producer must preserve and account for.
for (const kind of ['large-comment', 'large-scene'] as const) {
  test(`measures actual native Mermaid construction for ${kind}`, async ({ mount, page }, info) => {
    const code =
      kind === 'large-comment'
        ? '%%' + 'x'.repeat(2_000_000) + '\nflowchart LR\nA[Start] --> B[Finish]'
        : 'flowchart TB\n' + Array.from({ length: 200 }, (_, i) => `N${i}[Node ${i}]`).join('\n');
    const component = await mount(MermaidBlockLaneHarness, {
      props: { code, hostWidth: 900, editable: false },
    });
    const block = component.locator('[data-node-view-wrapper][data-render-state]');
    await expect(block).toHaveAttribute('data-render-state', 'rendered', { timeout: 15_000 });
    const svg = block.locator('svg[id^="mermaid-"]').first();
    await expect(svg).toBeVisible();
    const result = await svg.evaluate((element) => {
      const walker = document.createTreeWalker(element);
      let node: Node | null = walker.currentNode;
      let nodes = 0,
        bytes = 0;
      const encoder = new TextEncoder();
      while (node) {
        nodes++;
        bytes += encoder.encode(node.nodeName + (node.nodeValue ?? '')).length;
        if (node instanceof Element)
          for (const attr of node.attributes)
            bytes += encoder.encode(attr.name + attr.value).length;
        node = walker.nextNode();
      }
      const rect = element.getBoundingClientRect();
      return {
        nodes,
        payloadBytes: bytes,
        width: rect.width,
        height: rect.height,
        text: element.textContent,
        viewBox: element.getAttribute('viewBox'),
      };
    });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.text).not.toContain('Maximum text size');
    if (kind === 'large-comment') {
      expect(result.text).toContain('Start');
      expect(result.text).toContain('Finish');
      expect(result.payloadBytes).toBeLessThan(100_000);
    } else {
      expect(result.text).toContain('Node 199');
      expect(result.nodes).toBeGreaterThan(1000);
      expect(result.payloadBytes).toBeGreaterThan(code.length * 10);
    }
    await info.attach('native-construction-costs.json', {
      body: JSON.stringify({
        kind,
        inputUtf8Bytes: Buffer.byteLength(code),
        inputUtf16Units: code.length,
        ...result,
      }),
      contentType: 'application/json',
    });
    await info.attach('native-construction.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
