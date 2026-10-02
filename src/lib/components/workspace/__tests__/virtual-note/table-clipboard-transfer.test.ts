import { expect, it } from 'vitest';
import {
  ClipboardBacking,
  ExternalClipboardSink,
  relayClipboard,
  type ClipboardRelayStats,
} from './table-clipboard';
const stats = (): ClipboardRelayStats => ({
  maxPageBytes: 0,
  maxTransientBytes: 0,
  maxOutstandingPages: 0,
  pages: 0,
});
function prepare(repeats = 3000) {
  const backing = new ClipboardBacking(),
    sink = new ExternalClipboardSink();
  const value = {
    'text/plain': '漢字🌍"\\\n'.repeat(repeats),
    'text/html': '<td><strong>bold 🌍</strong></td>'.repeat(repeats),
  };
  const manifest = backing.open(7, {
    value,
    costs: { selectedSourceBytes: 0, nodes: 0, elements: 0, serializedPMBytes: 0 },
  });
  return { backing, sink, value, manifest };
}
it('relays exact Unicode clipboard output one bounded page at a time with output-sized external storage', () => {
  for (const count of [100, 3000]) {
    const { backing, sink, value, manifest } = prepare(count),
      meter = stats();
    relayClipboard(
      manifest,
      (index) => backing.page(manifest.id, index),
      sink,
      () => 7,
      meter,
    );
    expect(sink.published).toEqual(value);
    expect(sink.publications).toBe(1);
    expect(sink.stagingBytes).toBe(0);
    expect(meter.maxPageBytes).toBeLessThanOrEqual(4096);
    expect(meter.maxTransientBytes).toBeLessThanOrEqual(16384);
    expect(meter.maxOutstandingPages).toBe(1);
    expect(meter.pages).toBe(manifest.count);
    backing.close(manifest.id);
    expect(backing.retainedBytes).toBe(0);
  }
});
for (const fault of [
  'reordered',
  'duplicate',
  'missing',
  'stale-page',
  'stale-revision',
  'truncated',
  'altered',
  'cancel',
  'sink-error',
] as const) {
  it(`retains the prior clipboard atomically after ${fault}`, () => {
    const { backing, sink, manifest } = prepare(),
      meter = stats();
    const prior = { 'text/plain': 'old plain', 'text/html': '<p>old rich</p>' };
    sink.published = prior;
    let revision = 7,
      reads = 0;
    const accept = sink.accept.bind(sink);
    if (fault === 'sink-error')
      sink.accept = (page) => {
        if (page.index === 1) throw new Error('injected sink failure');
        accept(page);
      };
    expect(() =>
      relayClipboard(
        fault === 'truncated' ? { ...manifest, count: manifest.count - 1 } : manifest,
        (index) => {
          reads++;
          if (fault === 'missing' && index === 1) throw new Error('Missing clipboard page');
          if (fault === 'stale-revision' && index === 1) revision++;
          const page = backing.page(
            manifest.id,
            fault === 'reordered' ? index + 1 : fault === 'duplicate' && index === 1 ? 0 : index,
          );
          if (fault === 'stale-page') page.revision--;
          if (fault === 'altered' && index === 1) page.payload = page.payload.replace(/./u, 'Z');
          return page;
        },
        sink,
        () => revision,
        meter,
        () => fault === 'cancel' && reads === 2,
      ),
    ).toThrow();
    expect(sink.published).toBe(prior);
    expect(sink.publications).toBe(0);
    expect(sink.stagingBytes).toBe(0);
    backing.close(manifest.id);
    expect(backing.retainedBytes).toBe(0);
  });
}
