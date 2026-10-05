import { expect, it, vi } from 'vitest';
import type { NoteCommitReceipt } from './note-pages';
import { readNoteReceiptPage, type NoteReceiptReadRequest } from './note-receipt-reader';
const receipt: NoteCommitReceipt = {
  kind: 'noteCommitReceipt',
  outcome: 'committed',
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  operationId: 'operation',
  payloadDigest: 'a'.repeat(64),
  beforeRevision: 'r1',
  afterRevision: 'r2',
  sourceLength: 12,
  mappingRef: 'map',
  effectsRef: 'effect',
  inverseRef: 'inverse',
  receiptExpiresAt: '2099-01-01T00:00:00.000000001Z',
  invalidation: 'all',
};
const request: NoteReceiptReadRequest = {
  kind: 'mapping',
  baseLength: 10,
  maxItems: 1,
  maxWireBytes: 4096,
};
const page = () => ({
  kind: 'noteOperationPage',
  scope: { ...receipt.scope },
  operationId: receipt.operationId,
  payloadDigest: receipt.payloadDigest,
  beforeRevision: 'r1',
  afterRevision: 'r2',
  outputKind: 'mapping',
  sourceLength: 10,
  items: [{ start: 1, end: 1, insertedLength: 2 }],
  nextCursor: null,
  expiresAt: receipt.receiptExpiresAt,
});
it('uses only the receipt-owned inline root and preserves original expiry and cursor selectors', async () => {
  const response = page(),
    send = vi.fn().mockResolvedValue(response);
  expect(await readNoteReceiptPage(send, receipt, request)).toBe(response);
  expect(send).toHaveBeenCalledExactlyOnceWith({
    ...receipt.scope,
    operationId: 'operation',
    payloadDigest: 'a'.repeat(64),
    kind: 'mapping',
    ref: 'map',
    maxItems: 1,
    maxWireBytes: 4096,
  });
  const effects = { ...page(), outputKind: 'effects', convertedCount: 7, items: [] };
  send.mockResolvedValueOnce(effects);
  expect(
    await readNoteReceiptPage(send, receipt, {
      ...request,
      kind: 'effects',
      cursor: 'continuation',
    }),
  ).toBe(effects);
  expect(send).toHaveBeenLastCalledWith({
    ...receipt.scope,
    operationId: 'operation',
    payloadDigest: 'a'.repeat(64),
    kind: 'effects',
    ref: 'effect',
    cursor: 'continuation',
    maxItems: 1,
    maxWireBytes: 4096,
  });
});
it.each([
  { operationId: 'other' },
  { payloadDigest: 'other' },
  { beforeRevision: 'wrong' },
  { afterRevision: 'wrong' },
  { scope: { ...receipt.scope, backendId: 'foreign' } },
  { scope: { ...receipt.scope, noteInstanceId: 'foreign' } },
  { sourceLength: receipt.sourceLength },
  { outputKind: 'effects' },
  { headerDigest: 'staged' },
  { viewId: 'view' },
  { expiresAt: '2099-01-01T00:00:00Z' },
  { nextCursor: undefined },
  { items: [{}, {}] },
  { items: [{ text: '"'.repeat(4096) }] },
])('rejects mismatched or overbudget receipt envelope %j', async (delta) => {
  await expect(
    readNoteReceiptPage(vi.fn().mockResolvedValue({ ...page(), ...delta }), receipt, request),
  ).rejects.toThrow();
});
it.each([
  { maxItems: 0 },
  { maxItems: 129 },
  { maxWireBytes: 4095 },
  { maxWireBytes: 65537 },
  { baseLength: -1 },
  { cursor: '' },
])('refuses invalid admission bounds before transport %j', async (delta) => {
  const send = vi.fn();
  await expect(readNoteReceiptPage(send, receipt, { ...request, ...delta })).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it('rejects staged receipts and missing scope before transport', async () => {
  const send = vi.fn();
  await expect(
    readNoteReceiptPage(send, { ...receipt, headerDigest: 'staged' }, request),
  ).rejects.toThrow();
  await expect(
    readNoteReceiptPage(send, { ...receipt, scope: { ...receipt.scope, backendId: '' } }, request),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it('checks the original nanosecond deadline before dispatch and again after physical IO', async () => {
  const r = { ...receipt, receiptExpiresAt: '1970-01-01T00:00:01.000000001Z' };
  const send = vi.fn().mockResolvedValue({ ...page(), expiresAt: r.receiptExpiresAt });
  await expect(readNoteReceiptPage(send, r, request, () => 1000)).resolves.toMatchObject({
    expiresAt: r.receiptExpiresAt,
  });
  const late = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1001);
  await expect(readNoteReceiptPage(send, r, request, late)).rejects.toThrow('Receipt expired');
  send.mockClear();
  await expect(readNoteReceiptPage(send, r, request, () => 1001)).rejects.toThrow(
    'Receipt expired',
  );
  expect(send).not.toHaveBeenCalled();
});
it('captures identity and bounds before awaiting transport without automatic continuation', async () => {
  const r = { ...receipt, scope: { ...receipt.scope } },
    q = { ...request };
  const response = { ...page(), nextCursor: 'more' };
  const send = vi.fn(async () => {
    r.scope.backendId = 'changed';
    r.afterRevision = 'changed';
    r.receiptExpiresAt = '2100-01-01T00:00:00Z';
    q.baseLength = 99;
    q.maxItems = 99;
    return response;
  });
  expect(await readNoteReceiptPage(send, r, q)).toBe(response);
  expect(send).toHaveBeenCalledOnce();
});

it.each(['digest', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)])(
  'refuses malformed payload digest before dispatch: %s',
  async (payloadDigest) => {
    const send = vi.fn();
    await expect(readNoteReceiptPage(send, { ...receipt, payloadDigest }, request)).rejects.toThrow(
      'Invalid inline receipt read',
    );
    expect(send).not.toHaveBeenCalled();
  },
);
it.each([undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2'])(
  'refuses absent or invalid aggregate convertedCount: %s',
  async (convertedCount) => {
    const send = vi
      .fn()
      .mockResolvedValue({ ...page(), outputKind: 'effects', items: [], convertedCount });
    await expect(
      readNoteReceiptPage(send, receipt, { ...request, kind: 'effects' }),
    ).rejects.toThrow();
  },
);
it('retains aggregate conversion count independently of this page item count', async () => {
  const response = { ...page(), outputKind: 'effects', items: [], convertedCount: 19 };
  const result = await readNoteReceiptPage(vi.fn().mockResolvedValue(response), receipt, {
    ...request,
    kind: 'effects',
  });
  expect(result.outputKind).toBe('effects');
  if (result.outputKind !== 'effects') throw new Error('Wrong kind');
  expect(result.convertedCount).toBe(19);
  expect(result.items).toEqual([]);
});
it('refuses a page that expires during validation before returning it', async () => {
  const r = { ...receipt, receiptExpiresAt: '1970-01-01T00:00:01.000000001Z' };
  const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValueOnce(1001);
  const send = vi.fn().mockResolvedValue({ ...page(), expiresAt: r.receiptExpiresAt });
  await expect(readNoteReceiptPage(send, r, request, now)).rejects.toThrow('Receipt expired');
  expect(send).toHaveBeenCalledOnce();
  expect(now).toHaveBeenCalledTimes(3);
});
