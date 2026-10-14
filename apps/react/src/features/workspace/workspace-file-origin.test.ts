import { describe, expect, it } from 'vitest';
import {
  conversationFileSearch,
  parseConversationFileOrigin,
  workspaceFileBackSearch,
} from './workspace-file-origin';

const origin = {
  workspaceId: 'system-design',
  agentId: 'agent-reader',
  messageId: 'clicked-message',
};
const fallback = { note: 'note', q: 'notes search', fileQuery: 'files search' };

describe('conversation file return context', () => {
  it.each([undefined, { message: 'initial-target' }])(
    'returns to the clicked message regardless of the initial target %j',
    (route) => {
      const search = conversationFileSearch(
        { ...route, q: 'notes', fileQuery: 'files', homeQuery: 'home', homeFilter: 'all' },
        'system-design',
        { file: 'docs/result.md', line: 7 },
        origin,
      );
      expect(search).toEqual({
        file: 'docs/result.md',
        line: 7,
        q: 'notes',
        fileQuery: 'files',
        homeQuery: 'home',
        homeFilter: 'all',
        fileOrigin: JSON.stringify(origin),
      });
      expect(workspaceFileBackSearch('system-design', search.fileOrigin, fallback)).toEqual({
        agent: 'agent-reader',
        message: 'clicked-message',
        q: fallback.q,
        fileQuery: fallback.fileQuery,
      });
    },
  );
  it('does not derive origin from attachment registration or retain nested destinations', () => {
    const search = conversationFileSearch(
      {},
      'system-design',
      {
        file: '.intent/attachments/result.json',
        attachment: 'attachment',
        attachmentAgent: 'different-agent',
      },
      origin,
    );
    expect(workspaceFileBackSearch('system-design', search.fileOrigin, {})).toEqual({
      agent: origin.agentId,
      message: origin.messageId,
    });
  });
  it.each([
    undefined,
    null,
    [],
    '',
    '[object Object]',
    '{invalid',
    'null',
    '"string"',
    JSON.stringify({ ...origin, workspaceId: 'other-workspace' }),
    'x'.repeat(1025),
    {},
    { ...origin, messageId: '' },
    { ...origin, agentId: ['agent'] },
    { ...origin, workspaceId: 'https://elsewhere.example' },
    { ...origin, messageId: '../message' },
    { ...origin, messageId: 'm'.repeat(257) },
    { ...origin, workspaceId: 'other-workspace' },
  ])('keeps the local workspace fallback for invalid or cross-workspace context %j', (value) => {
    expect(workspaceFileBackSearch('system-design', value, fallback)).toEqual(fallback);
  });
  it('survives the router URLSearchParams codec as explicit context', () => {
    const search = conversationFileSearch({}, origin.workspaceId, { file: 'result.md' }, origin);
    const encoded = new URLSearchParams(
      Object.entries(search)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    expect(parseConversationFileOrigin(encoded.get('fileOrigin'))).toEqual(origin);
    expect(
      workspaceFileBackSearch(origin.workspaceId, encoded.get('fileOrigin'), fallback),
    ).toMatchObject({ agent: origin.agentId, message: origin.messageId });
  });
  it('discards cross-workspace origin at creation and ignores arbitrary redirect keys', () => {
    expect(
      conversationFileSearch({}, 'another-workspace', { file: 'docs/result.md' }, origin)
        .fileOrigin,
    ).toBeUndefined();
    expect(
      parseConversationFileOrigin({
        ...origin,
        href: 'https://elsewhere.example',
        file: '/etc/passwd',
      }),
    ).toEqual(origin);
  });
});
