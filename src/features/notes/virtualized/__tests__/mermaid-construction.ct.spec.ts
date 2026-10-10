import { expect, test } from '../../../../test/ct-test';
import MermaidConstructionHarness from './MermaidConstructionHarness.svelte';

for (const kind of ['large-comment', 'large-scene'] as const) {
  test(`constructs a lossless native Mermaid artifact for ${kind}`, async ({ mount }, info) => {
    const code =
      kind === 'large-comment'
        ? '%%' + 'x'.repeat(2_000_000) + '\nflowchart LR\nA[Start] --> B[Finish]'
        : 'flowchart TB\n' + Array.from({ length: 200 }, (_, i) => `N${i}[Node ${i}]`).join('\n');
    const component = await mount(MermaidConstructionHarness, { props: { code } });
    await expect(component).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
    const result = await component.getByTestId('construction-root').evaluate(
      (element) =>
        (
          element as HTMLElement & {
            result: {
              records: string[];
              manifest: { nodes: number; records: number; outputBytes: number };
              costs: unknown;
              remainingNodes: number;
            };
          }
        ).result,
    );
    const parsed = result.records.map((record) => JSON.parse(record));
    const text = parsed
      .filter((record) => record.kind === 'text')
      .map((record) => record.text)
      .join('');
    expect(text).toContain(kind === 'large-comment' ? 'Start' : 'Node 199');
    expect(result.manifest.nodes).toBeGreaterThan(kind === 'large-comment' ? 20 : 1000);
    expect(result.manifest.records).toBe(result.records.length);
    expect(result.records.every((record) => Buffer.byteLength(record) <= 16384)).toBe(true);
    expect(parsed.some((record) => record.kind === 'geometry' && record.box[2] > 0)).toBe(true);
    expect(result.remainingNodes).toBe(0);
    await info.attach('native-artifact-construction.json', {
      body: JSON.stringify({ kind, manifest: result.manifest, costs: result.costs }),
      contentType: 'application/json',
    });
  });
}
