import { describe, expect, it } from 'vitest';
import { TC_ADDRESS } from '../../../test/fixtures/tc-address.fixture';
import {
  isMainOnlyLinkUri,
  isNodeInviteUri,
  maskNodeInviteUri,
  parseNodeInviteUri,
} from '../node-invite-uri';

const SECRET = 'invite-secret-value';
const LINK = `intent://node?v=1&host=192.0.2.20,10.0.0.4&port=7443&fp=AA%3ABB&tc=${TC_ADDRESS}&invite=inv_1&secret=${SECRET}`;

describe('isNodeInviteUri', () => {
  it('recognizes node links, whatever the case and surrounding space', () => {
    expect(isNodeInviteUri(LINK)).toBe(true);
    expect(isNodeInviteUri('  INTENT://NODE?invite=x  ')).toBe(true);
    expect(isNodeInviteUri('intent://node')).toBe(true);
    expect(isNodeInviteUri('intent://node/?invite=x')).toBe(true);
  });

  it('rejects other links and actions that only start with "node"', () => {
    expect(isNodeInviteUri('intent://pair?token=t')).toBe(false);
    expect(isNodeInviteUri('intent://nodes?invite=x')).toBe(false);
    expect(isNodeInviteUri('https://example.com/node')).toBe(false);
  });

  it('routes node and pair links in main, never other intent:// links', () => {
    expect(isMainOnlyLinkUri(LINK)).toBe(true);
    expect(isMainOnlyLinkUri('intent://pair?token=t')).toBe(true);
    expect(isMainOnlyLinkUri('intent://open?id=ws_1')).toBe(false);
  });
});

describe('parseNodeInviteUri', () => {
  it('reads every field', () => {
    expect(parseNodeInviteUri(LINK)).toEqual({
      version: 1,
      hosts: ['192.0.2.20', '10.0.0.4'],
      port: 7443,
      fingerprint: 'AA:BB',
      tcAddress: TC_ADDRESS,
      inviteId: 'inv_1',
      secret: SECRET,
    });
  });

  it('keeps missing or invalid fields null so the caller can say what is missing', () => {
    expect(parseNodeInviteUri('intent://node?port=99999&host=,')).toEqual({
      version: null,
      hosts: [],
      port: null,
      fingerprint: null,
      tcAddress: null,
      inviteId: null,
      secret: null,
    });
  });

  it('reads a version it does not know, for the caller to refuse', () => {
    expect(parseNodeInviteUri('intent://node?v=2&invite=i')?.version).toBe(2);
    expect(parseNodeInviteUri('intent://node?v=x&invite=i')?.version).toBeNaN();
  });

  it('is never an owner pairing link: a token is ignored', () => {
    const parsed = parseNodeInviteUri(`${LINK}&token=owner`);
    expect(parsed).not.toHaveProperty('token');
  });

  it('returns null for other text', () => {
    expect(parseNodeInviteUri('intent://pair?v=1&token=t')).toBeNull();
    expect(parseNodeInviteUri('GPU rig')).toBeNull();
  });
});

describe('maskNodeInviteUri', () => {
  it('hides the invite secret', () => {
    const masked = maskNodeInviteUri(LINK);
    expect(masked).not.toContain(SECRET);
    expect(masked).toContain('secret=••••');
    expect(masked).toContain('invite=inv_1');
  });
});
