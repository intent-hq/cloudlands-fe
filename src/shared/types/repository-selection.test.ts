import { describe, expect, it } from 'vitest';
import {
  SelectionCaptureSchema,
  SelectionCommandSchema,
  SelectionQuerySchema,
  SelectionAttemptSchema,
} from './repository-selection';
const root = { kind: 'primary', workspaceId: 'ws' };
// Manually authored from accepted Core source; no Rust fixture-generation claim.
const capture = {
  selectionId: 'edit',
  scope: { daemonId: 'A', authorityScopeId: 'edit', authorityGeneration: '9007199254740993' },
  root,
  snapshot: {
    root,
    rootIncarnation: '18446744073709551615',
    selectionRevision: '0',
    selection: { kind: 'neverSaved' },
  },
  retirementSequence: '0',
  expiresAfterMs: 300000,
};
describe('compiled selection ABI', () => {
  it('preserves primary null/omission and exact counter strings', () => {
    expect(SelectionQuerySchema.parse({ workspaceId: 'ws', gitRootId: null })).toEqual({
      workspaceId: 'ws',
      gitRootId: null,
    });
    expect(SelectionQuerySchema.parse({ workspaceId: 'ws' })).toEqual({ workspaceId: 'ws' });
    expect(SelectionCaptureSchema.parse(capture)).toEqual(capture);
  });
  it.each([1, '01', '-1', '1e3', '18446744073709551616'])(
    'rejects noncanonical counter %j',
    (value) => {
      expect(
        SelectionCaptureSchema.safeParse({ ...capture, retirementSequence: value }).success,
      ).toBe(false);
    },
  );
  it.each([
    { kind: 'reset' },
    { kind: 'saved', value: { mode: 'unresolved-historical' } },
    {
      kind: 'saved',
      value: { mode: 'unresolved-historical', source: 'workspace-metadata', recordId: '' },
    },
  ])('retains original historical/empty provenance %j', (selection) => {
    const raw = { ...capture, snapshot: { ...capture.snapshot, selection } };
    expect(SelectionCaptureSchema.parse(raw)).toEqual(raw);
  });
  it('preserves failed plus committed independently', () => {
    const raw = {
      selectionId: 'edit',
      root,
      attempt: {
        status: 'settled',
        receipt: {
          result: { kind: 'failed', code: 'admission-retired' },
          persistence: { kind: 'committed', selectionRevision: '9007199254740994' },
        },
      },
    };
    expect(SelectionAttemptSchema.parse(raw)).toEqual(raw);
  });
  it.each(['', ' leading', 'trailing ', 'a\u007fb', 'a\u0085b', 'é'.repeat(513)])(
    'rejects Rust-invalid remote %j',
    (remoteName) => {
      expect(
        SelectionCommandSchema.safeParse({
          kind: 'save',
          choice: { mode: 'explicit-remote', remoteName },
        }).success,
      ).toBe(false);
    },
  );
  it('accepts valid Unicode scalars and refuses strings Rust cannot represent', () => {
    const parse = (remoteName: string) =>
      SelectionCommandSchema.safeParse({
        kind: 'save',
        choice: { mode: 'explicit-remote', remoteName },
      });
    expect(parse('😀'.repeat(256)).success).toBe(true);
    expect(parse('\uFEFForigin').success).toBe(true);
    expect(parse('\uD800').success).toBe(false);
    expect(parse('\uDC00').success).toBe(false);
  });
  it('accepts exact UTF8 bound and rejects renderer authority fields', () => {
    expect(
      SelectionCommandSchema.parse({
        kind: 'save',
        choice: { mode: 'explicit-remote', remoteName: 'é'.repeat(512) },
      }),
    ).toBeDefined();
    expect(SelectionCommandSchema.safeParse({ kind: 'reset', selectionId: 'forged' }).success).toBe(
      false,
    );
    expect(
      SelectionCommandSchema.safeParse({ kind: 'save', choice: { mode: 'unresolved-historical' } })
        .success,
    ).toBe(false);
  });
});
