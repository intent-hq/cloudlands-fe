import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  dispatch: vi.fn(),
  navigateToRoute: vi.fn(),
  openMessage: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectCurrentWorkspace: { select: () => ({ id: 'globally-active-workspace' }) },
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));
vi.mock('./navigation.client', () => ({ navigateToRoute: mocks.navigateToRoute }));
vi.mock('./open-message', () => ({ openMessage: mocks.openMessage }));

import { handleIntentLink } from './workspaces-link-handler';

describe('handleIntentLink panel navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backendRequest.mockResolvedValue({ note: { id: 'spec', title: 'Spec' } });
  });

  it('checks and opens a short note link in the owning chat workspace', async () => {
    await handleIntentLink('intent://local/note/spec', {
      workspaceId: 'owning-workspace',
      sourcePanelId: 'panel-chat',
    });

    expect(mocks.backendRequest).toHaveBeenCalledWith('note.get', {
      workspaceId: 'owning-workspace',
      noteId: 'spec',
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceNote('owning-workspace', 'spec', {
        openInAdjacentPanel: false,
        openInNewAdjacentPanel: false,
        sourcePanelId: 'panel-chat',
      }),
    );
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
  });

  it('preserves the request for a fresh adjacent panel', async () => {
    await handleIntentLink('intent://local/note/spec', {
      workspaceId: 'owning-workspace',
      sourcePanelId: 'panel-note',
      openInAdjacentPanel: true,
      openInNewAdjacentPanel: true,
    });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceNote('owning-workspace', 'spec', {
        openInAdjacentPanel: true,
        openInNewAdjacentPanel: true,
        sourcePanelId: 'panel-note',
      }),
    );
  });

  it('opens a short file link at its line fragment in the owning chat workspace', async () => {
    await handleIntentLink('intent://local/file/src/lib/utils/foo.ts#L10', {
      workspaceId: 'owning-workspace',
      sourcePanelId: 'panel-chat',
    });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceFile('owning-workspace', 'src/lib/utils/foo.ts', {
        line: 10,
        openInAdjacentPanel: false,
        sourcePanelId: 'panel-chat',
      }),
    );
    expect(mocks.backendRequest).not.toHaveBeenCalled();
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
  });

  it('opens a same-workspace long file link at the start of its line range', async () => {
    await handleIntentLink('intent://local/owning-workspace/file/README.md#L10-20', {
      workspaceId: 'owning-workspace',
      sourcePanelId: 'panel-chat',
      openInAdjacentPanel: true,
    });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceFile('owning-workspace', 'README.md', {
        line: 10,
        openInAdjacentPanel: true,
        sourcePanelId: 'panel-chat',
      }),
    );
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
  });

  it('navigates to the target workspace for a cross-workspace file link', async () => {
    await handleIntentLink('intent://local/other-workspace/file/docs/guide.md', {
      workspaceId: 'owning-workspace',
      sourcePanelId: 'panel-chat',
      openInAdjacentPanel: true,
    });

    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/other-workspace');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceFile('other-workspace', 'docs/guide.md', {
        openInAdjacentPanel: false,
        sourcePanelId: undefined,
      }),
    );
  });

  it('opens a canonical conversation message link at the exact message', async () => {
    await handleIntentLink('intent://local/__chief__/agent/agent-chief-1/message/msg-source-1', {
      workspaceId: 'owning-workspace',
    });

    expect(mocks.openMessage).toHaveBeenCalledWith({
      workspaceId: '__chief__',
      agentId: 'agent-chief-1',
      messageId: 'msg-source-1',
    });
    expect(mocks.backendRequest).not.toHaveBeenCalled();
  });

  it('opens a completed relay link at the exact target message', async () => {
    await handleIntentLink(
      'intent://local/target-workspace/agent/agent-target-1/message/msg-final-assistant',
      { workspaceId: '__chief__' },
    );

    expect(mocks.openMessage).toHaveBeenCalledWith({
      workspaceId: 'target-workspace',
      agentId: 'agent-target-1',
      messageId: 'msg-final-assistant',
    });
  });

  it.each(['.', '..', '%2e', '%2e%2e', '%2F', '%5C'])(
    'fails closed for unsafe message workspace segment %s',
    async (workspaceSegment) => {
      await handleIntentLink(
        `intent://local/${workspaceSegment}/agent/agent-target-1/message/msg-final-assistant`,
        { workspaceId: 'owning-workspace' },
      );

      expect(mocks.openMessage).not.toHaveBeenCalled();
      expect(mocks.navigateToRoute).not.toHaveBeenCalled();
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['agent', '%2e%2e'],
    ['agent', '%2F'],
    ['agent', 'agent\\other'],
    ['message', '%2e%2e'],
    ['message', '%5C'],
    ['message', 'msg/other'],
  ])('fails closed for unsafe %s segment %s', async (segmentType, unsafeSegment) => {
    const agentSegment = segmentType === 'agent' ? unsafeSegment : 'agent-target-1';
    const messageSegment = segmentType === 'message' ? unsafeSegment : 'msg-final-assistant';

    await handleIntentLink(
      `intent://local/target-workspace/agent/${agentSegment}/message/${messageSegment}`,
      { workspaceId: 'owning-workspace' },
    );

    expect(mocks.openMessage).not.toHaveBeenCalled();
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
