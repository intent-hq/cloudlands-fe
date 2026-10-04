import { expect, it } from 'vitest';
import { measureNoteDom } from './note-dom-cost';
it('counts exact UTF-8 payloads, including shadow output, without serializing HTML', () => {
  const root = document.createElement('div');
  root.setAttribute('title', 'café 🌍\ud800');
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.append(document.createTextNode('λ\udfff'));
  Object.defineProperty(root, 'outerHTML', {
    get() {
      throw new Error('No snapshot');
    },
  });
  const measured = measureNoteDom(root);
  expect(measured.nodes).toBe(3);
  expect(measured.shadowRoots).toEqual([shadow]);
  expect(measured.payloadBytes).toBe(
    new TextEncoder().encode('DIVtitlecafé 🌍\ud800#document-fragment#textλ\udfff').length,
  );
});
