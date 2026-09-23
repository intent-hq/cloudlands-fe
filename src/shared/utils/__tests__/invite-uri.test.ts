import { describe, expect, it } from 'vitest';

import { isInviteUri, parseInviteUri } from '../invite-uri';

// The canonical shape from `workspace.invite.create` (intentd invites):
// intent://invite?v=1&host=<ip[,ip...]>&port=<p>&fp=<sha256>&inviteId=<id>&secret=<s>[&tc=<addr>]
const FULL_URI =
  'intent://invite?v=1&host=192.168.1.10,10.0.0.5&port=5181&fp=AA%3ABB%3ACC&inviteId=inv_42&secret=s3cr3t&tc=tc7f2a91.tailcat.net';

describe('isInviteUri', () => {
  it('recognizes invite URIs (case-insensitive, surrounding whitespace)', () => {
    expect(isInviteUri(FULL_URI)).toBe(true);
    expect(isInviteUri('  INTENT://INVITE?inviteId=x  ')).toBe(true);
  });

  it('rejects other intent actions and non-intent text', () => {
    expect(isInviteUri('intent://pair?token=t')).toBe(false);
    expect(isInviteUri('intent://open?id=ws_1')).toBe(false);
    expect(isInviteUri('https://example.com')).toBe(false);
  });

  it('rejects undefined actions that merely start with "invite"', () => {
    expect(isInviteUri('intent://invites?inviteId=x')).toBe(false);
    expect(isInviteUri('intent://invited')).toBe(false);
  });

  it('accepts exact-action variants (bare, query, path, fragment)', () => {
    expect(isInviteUri('intent://invite')).toBe(true);
    expect(isInviteUri('intent://invite/?inviteId=x')).toBe(true);
    expect(isInviteUri('intent://invite#x')).toBe(true);
  });

  it('classifies like the URL parser: tab/LF/CR inside the action are stripped', () => {
    // WHATWG URL strips ASCII tab/newline anywhere in the input, so these
    // parse as `intent://invite?…`; the classifier must agree or the secret
    // falls through to the generic deep-link route.
    expect(isInviteUri('intent://inv\nite?secret=s3cr3t')).toBe(true);
    expect(isInviteUri('intent://in\tvite?secret=s3cr3t')).toBe(true);
    expect(isInviteUri('intent:\r\n//invite?secret=s3cr3t')).toBe(true);
    expect(isInviteUri('intent://inv\nites?secret=s3cr3t')).toBe(false);
  });
});

describe('parseInviteUri', () => {
  it('parses an invite whose action carries URL-stripped line breaks', () => {
    expect(parseInviteUri('intent://inv\nite?inviteId=inv_42&sec\tret=s3cr3t')).toMatchObject({
      inviteId: 'inv_42',
      secret: 's3cr3t',
    });
  });

  it('parses every component field including the tc= tunnel address', () => {
    expect(parseInviteUri(FULL_URI)).toEqual({
      hosts: ['192.168.1.10', '10.0.0.5'],
      port: 5181,
      fingerprint: 'AA:BB:CC',
      inviteId: 'inv_42',
      secret: 's3cr3t',
      tcAddress: 'tc7f2a91.tailcat.net',
    });
  });

  // The tunnel-only envelope the daemon mints: no `host` parameter at all,
  // `tc=` mandatory. An absent `host` is an empty host list, not a failure.
  it('parses a tunnel-only invite with no host parameter to an empty host list', () => {
    expect(
      parseInviteUri(
        'intent://invite?v=1&port=5181&fp=AA%3ABB%3ACC&inviteId=inv_42&secret=s3cr3t&tc=tc7f2a91.tailcat.net',
      ),
    ).toEqual({
      hosts: [],
      port: 5181,
      fingerprint: 'AA:BB:CC',
      inviteId: 'inv_42',
      secret: 's3cr3t',
      tcAddress: 'tc7f2a91.tailcat.net',
    });
  });

  it('returns null for non-invite text', () => {
    expect(parseInviteUri('intent://pair?v=1&host=h&port=1&fp=AA&token=t')).toBeNull();
    expect(parseInviteUri('not a uri')).toBeNull();
  });

  it('reports missing or invalid fields individually as null', () => {
    expect(parseInviteUri('intent://invite?v=1&host=h&port=99999&fp=&inviteId=i')).toEqual({
      hosts: ['h'],
      port: null,
      fingerprint: null,
      inviteId: 'i',
      secret: null,
      tcAddress: null,
    });
  });

  it('ignores unknown query params', () => {
    const parsed = parseInviteUri('intent://invite?inviteId=i&secret=s&future=1');
    expect(parsed).toMatchObject({ inviteId: 'i', secret: 's', hosts: [], port: null });
  });
});
