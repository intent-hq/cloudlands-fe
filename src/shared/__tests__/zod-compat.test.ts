import { describe, expect, it } from 'vitest';
import { UserMcpAuthenticateSchema } from '../../main/ipc-schemas';
import { FirstVisitStateSchema } from '../schemas';
import { AgentCheckpointSchema } from '../types/agent-node';
import { CheckoutProjectQuerySchema, CheckoutProjectSchema } from '../types/repository-checkout';
import { emailString, isoDateTime, urlString } from '../zod-compat';

// Expectations are zod 3.25.76 results; the zod 4 migration must not change them.
const accepted = [
  '2024-01-01T00:00Z',
  '2024-01-01T23:59:59Z',
  '2024-01-01T23:59:59.1Z',
  '2024-01-01T23:59:59.123456789Z',
  '2024-02-29T12:00:00Z',
];
const rejected = [
  '',
  'garbage',
  '2024-01-01',
  '2024-01-01T00Z',
  '2024-01-01T24:00Z',
  '2024-01-01T00:60Z',
  '2023-02-29T00:00Z',
  '2024-01-01T00:00:00',
  '2024-01-01T00:00:00.Z',
  '2024-01-01 00:00:00Z',
  ' 2024-01-01T00:00:00Z',
];
const offsets = [
  '2024-01-01T00:00+02:00',
  '2024-01-01T00:00:00+0200',
  '2024-01-01T00:00:00.5-0530',
];
const badOffsets = [
  '2024-01-01T00:00:00+2',
  '2024-01-01T00:00:00+02:0',
  '2024-01-01T00:00:00+02:00Z',
];

const visit = (lastUpdated: string) => ({
  version: 1,
  workspaceId: 'cold-heron',
  firstVisitSetupReady: true,
  mainContentRevealed: true,
  navigationRailRevealed: true,
  workspaceDockRevealed: true,
  lastUpdated,
});
const checkpoint = (at: string) => ({
  id: 'checkpoint-1',
  assignmentEpoch: '1',
  captureRevision: '1',
  capturedAt: at,
  committedAt: at,
});

describe('zod 3 datetime semantics', () => {
  it.each(accepted)('accepts %s without an offset option', (value) => {
    expect(isoDateTime().safeParse(value).success).toBe(true);
    expect(FirstVisitStateSchema.safeParse(visit(value)).success).toBe(true);
    expect(AgentCheckpointSchema.safeParse(checkpoint(value)).success).toBe(true);
  });
  it.each(rejected)('rejects %j', (value) => {
    expect(isoDateTime().safeParse(value).success).toBe(false);
    expect(isoDateTime({ offset: true }).safeParse(value).success).toBe(false);
    expect(FirstVisitStateSchema.safeParse(visit(value)).success).toBe(false);
  });
  it.each(offsets)('accepts the offset %s only with offset: true', (value) => {
    expect(isoDateTime({ offset: true }).safeParse(value).success).toBe(true);
    expect(AgentCheckpointSchema.safeParse(checkpoint(value)).success).toBe(true);
    expect(isoDateTime().safeParse(value).success).toBe(false);
    expect(FirstVisitStateSchema.safeParse(visit(value)).success).toBe(false);
  });
  it.each(badOffsets)('rejects the malformed offset %s', (value) => {
    expect(AgentCheckpointSchema.safeParse(checkpoint(value)).success).toBe(false);
  });
  it('keeps the zod 3 default and custom messages', () => {
    expect(isoDateTime().safeParse('x').error?.issues[0]?.message).toBe('Invalid datetime');
    expect(isoDateTime({ message: 'when?' }).safeParse('x').error?.issues[0]?.message).toBe(
      'when?',
    );
  });
});

describe('zod 3 url semantics', () => {
  const padded = ' https://example.com/a\n';
  it('returns a URL with surrounding whitespace unchanged', () => {
    expect(urlString().parse(padded)).toBe(padded);
    expect(UserMcpAuthenticateSchema.parse({ serverId: 's', url: padded }).url).toBe(padded);
    expect(CheckoutProjectQuerySchema.parse({ url: padded })).toEqual({ url: padded });
    const project = CheckoutProjectSchema.parse({
      projectPath: 'owner/repo',
      name: 'repo',
      namespace: 'owner',
      webUrl: padded,
      cloneUrl: 'https://example.com/owner/repo.git\t',
      ownerAvatarUrl: padded,
    });
    expect(project).toMatchObject({
      webUrl: padded,
      cloneUrl: 'https://example.com/owner/repo.git\t',
      ownerAvatarUrl: padded,
    });
  });
  it('accepts exactly what new URL() accepts', () => {
    for (const value of ['mailto:a@b.co', 'custom-scheme:opaque', 'http://localhost:3000']) {
      expect(urlString().safeParse(value).success).toBe(true);
    }
    for (const value of ['', 'not a url', 'https://exa mple.com', '//example.com']) {
      expect(urlString().safeParse(value).success).toBe(false);
    }
    expect(
      UserMcpAuthenticateSchema.safeParse({ serverId: 's', url: 'nope' }).error?.issues[0]?.message,
    ).toBe('A valid MCP server URL is required');
  });
});

describe('zod 3 email semantics', () => {
  it('matches the zod 3 email grammar', () => {
    for (const value of ['a@b.co', "o'neil+tag@sub.Example.COM", 'a.b-c_d@x-y.io']) {
      expect(emailString().safeParse(value).success).toBe(true);
    }
    for (const value of ['.a@b.co', 'a..b@b.co', "a'@b.co", 'a@b', 'a@-b.co', 'a@b.c', ' a@b.co']) {
      expect(emailString().safeParse(value).success).toBe(false);
    }
  });
});
