import { expect, it } from 'vitest';
import { readNoteReceiptPage } from '$lib/client/note-receipt-reader';
import type { NoteCommitReceipt } from '$lib/client/note-pages';
import {
  parseLocalPointCanonicalReceiptData,
  readLocalPointCanonicalReceipt,
} from './note-local-point-canonical-receipt';
import { currentPointCanonicalCertificate } from './note-local-point-save-sponsor';
import captured from './__fixtures__/note-local-point/canonical-receipt-attempt4.json';

// Historical immutable DATA under the original recorded clock. This is NOT a
// newly sponsored operation or a certificate for a newly constructed native root.
function historical(
  change?: (value: Record<string, unknown>, request: Record<string, unknown>) => void,
) {
  const receipt = JSON.parse(captured.frames[0].responseFrame).result as NoteCommitReceipt;
  let calls = 0;
  const read = (request: Parameters<typeof readNoteReceiptPage>[2]) =>
    readNoteReceiptPage(
      async (params) => {
        const found = captured.frames.slice(1).find((f) => {
          const expected = JSON.parse(f.requestFrame).params;
          return expected.kind === params.kind && expected.ref === params.ref;
        });
        expect(found).toBeDefined();
        expect(params).toEqual(JSON.parse(found!.requestFrame).params);
        calls++;
        const value = JSON.parse(found!.responseFrame).result;
        change?.(value, params);
        return value;
      },
      receipt,
      request,
      () => captured.capturedAtMs,
    );
  return { receipt, read, calls: () => calls };
}
it('parses all unchanged actual receipt frames as DATA without minting a runtime certificate', async () => {
  const source = JSON.stringify(captured),
    f = historical();
  const data = await parseLocalPointCanonicalReceiptData(f.receipt, f.read, captured, () => true);
  expect(data.before).toBe('ab');
  expect(data.callerLength).toBe(59);
  expect(data.final).toBe('aXb');
  expect(data.inverse).toEqual({ start: 1, end: 2, text: '' });
  expect(data.group).toBe(1);
  expect(f.calls()).toBe(12);
  expect(currentPointCanonicalCertificate(data)).toBe(false);
  expect(JSON.stringify(captured)).toBe(source);
});
it.each([
  'group',
  'phase',
  'inverse',
  'provenance',
  'digest',
  'extra-effect',
  'extra-mapping',
  'missing-empty',
  'wrong-view',
])('refuses historical DATA mutation: %s', async (kind) => {
  const f = historical((v, q) => {
    const items = v.items as Array<Record<string, unknown>>;
    if (kind === 'wrong-view') v.viewId = 'other';
    if (kind === 'phase' && q.kind === 'effects') items[0].outputState = items[0].inputState;
    if (kind === 'extra-effect' && q.kind === 'effects') items.push({ ...items[0] });
    if (kind === 'extra-mapping' && q.kind === 'mapping') items.push({ ...items[0] });
    if (kind === 'inverse' && q.kind === 'inverse') items[0].end = 3;
    if (kind === 'digest' && q.kind === 'inverse')
      (items[0].replacement as Record<string, unknown>).sha256 = '0'.repeat(64);
    if (kind === 'missing-empty' && q.kind === 'inverseText') v.items = [];
    if (kind === 'provenance' && q.kind === 'detail')
      for (const node of items) if (node.key === 'kind') node.value = 'foreignProvenance';
  });
  await expect(
    parseLocalPointCanonicalReceiptData(
      f.receipt,
      f.read,
      { ...captured, group: kind === 'group' ? 2 : 1 },
      () => true,
    ),
  ).rejects.toThrow();
});
it('rejects structural observer methods before invoking any supplied callback', async () => {
  let invoked = false;
  const fake = {
    current: () => {
      invoked = true;
      return true;
    },
  };
  // @ts-expect-error An intentionally forged structural observer is not a credential.
  await expect(readLocalPointCanonicalReceipt(fake, captured, () => true)).rejects.toThrow();
  expect(invoked).toBe(false);
});
