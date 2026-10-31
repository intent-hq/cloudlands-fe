/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { SECRET_REQUEST_RESOURCE_MIME_TYPE } from '$shared/types/secret-request-resource';
import { store as appStore } from '$store/renderer/store';
import {
  secretAnswerRequested,
  secretAnswerUpdated,
  secretListLoaded,
  secretRequestsExpanded,
} from '$store/renderer/slices/secret-requests/secret-requests-slice';
import SecretRequestCards from '../SecretRequestCards.svelte';
import { deriveSecretRequestTranscript } from '../pending-secret-requests';

function card(requestId: string, name: string) {
  return {
    type: 'resource',
    resource: {
      uri: `intent-secret-request://${requestId}`,
      name,
      mimeType: SECRET_REQUEST_RESOURCE_MIME_TYPE,
      text: JSON.stringify({ requestId, agentId: 'agent-stack', name, reason: 'run tests' }),
    },
  };
}

function transcriptFor(...requests: [string, string][]) {
  const message = {
    id: 'm-1',
    role: 'assistant',
    contentBlocks: requests.map(([id, name]) => card(id, name)),
  } as unknown as AgentMessage;
  return deriveSecretRequestTranscript([message]);
}

function pending(agentId: string, ...requests: [string, string][]) {
  appStore.dispatch(
    secretListLoaded(
      agentId,
      {
        secrets: [],
        pendingRequests: requests.map(([requestId, name]) => ({ requestId, name })),
        answeredRequests: [],
      },
      requests.map(([requestId]) => requestId),
      0,
    ),
  );
}

beforeAll(() => appStore.init());

describe('SecretRequestCards', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Hide collapses the stack to a chip and expanding restores the cards', async () => {
    const agentId = 'agent-stack-hide';
    pending(agentId, ['sec-h1', 'KEY_ONE'], ['sec-h2', 'KEY_TWO']);
    render(SecretRequestCards, {
      props: {
        transcript: transcriptFor(['sec-h1', 'KEY_ONE'], ['sec-h2', 'KEY_TWO']),
        workspaceId: 'ws-1',
        agentId,
      },
    });
    expect(screen.getAllByTestId('secret-request-card')).toHaveLength(2);
    await fireEvent.click(screen.getAllByTestId('secret-request-hide')[0]);
    await waitFor(() => expect(screen.getByTestId('secret-request-chip')).toBeTruthy());
    expect(screen.queryByTestId('secret-request-card')).toBeNull();
    // Several requests: the chip offers no Dismiss; the user expands to choose.
    expect(screen.queryByTestId('secret-request-chip-dismiss')).toBeNull();
    await fireEvent.click(screen.getByTestId('secret-request-expand'));
    await waitFor(() => expect(screen.getAllByTestId('secret-request-card')).toHaveLength(2));
  });

  it('a new request expands a collapsed stack again', async () => {
    const agentId = 'agent-stack-new';
    pending(agentId, ['sec-n1', 'KEY_ONE']);
    const view = render(SecretRequestCards, {
      props: { transcript: transcriptFor(['sec-n1', 'KEY_ONE']), workspaceId: 'ws-1', agentId },
    });
    await fireEvent.click(screen.getByTestId('secret-request-hide'));
    await waitFor(() => expect(screen.getByTestId('secret-request-chip')).toBeTruthy());
    pending(agentId, ['sec-n1', 'KEY_ONE'], ['sec-n2', 'KEY_TWO']);
    await view.rerender({
      transcript: transcriptFor(['sec-n1', 'KEY_ONE'], ['sec-n2', 'KEY_TWO']),
      workspaceId: 'ws-1',
      agentId,
    });
    await waitFor(() => expect(screen.getAllByTestId('secret-request-card')).toHaveLength(2));
    expect(screen.queryByTestId('secret-request-chip')).toBeNull();
    appStore.dispatch(secretRequestsExpanded(agentId));
  });

  it('the chip dismisses a single pending request after confirmation', async () => {
    const agentId = 'agent-stack-chip';
    const dispatch = vi.spyOn(appStore, 'dispatch');
    pending(agentId, ['sec-c1', 'KEY_ONE']);
    render(SecretRequestCards, {
      props: { transcript: transcriptFor(['sec-c1', 'KEY_ONE']), workspaceId: 'ws-1', agentId },
    });
    await fireEvent.click(screen.getByTestId('secret-request-hide'));
    await fireEvent.click(await screen.findByTestId('secret-request-chip-dismiss'));
    const answers = () =>
      dispatch.mock.calls
        .map(([action]) => action as { type: string; payload?: unknown[] })
        .filter((action) => action.type === secretAnswerRequested.type);
    expect(answers()).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss request' }));
    expect(answers()).toHaveLength(1);
    expect(answers()[0]?.payload?.[0]).toEqual({
      workspaceId: 'ws-1',
      agentId,
      requestId: 'sec-c1',
      outcome: 'declined',
    });
  });

  it('Hide moves keyboard focus to the chip, and expanding moves it back to the card', async () => {
    const agentId = 'agent-stack-focus';
    pending(agentId, ['sec-f1', 'KEY_ONE']);
    render(SecretRequestCards, {
      props: { transcript: transcriptFor(['sec-f1', 'KEY_ONE']), workspaceId: 'ws-1', agentId },
    });
    const hideButton = screen.getByTestId('secret-request-hide');
    hideButton.focus();
    await fireEvent.click(hideButton);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('secret-request-expand')),
    );
    await fireEvent.click(screen.getByTestId('secret-request-expand'));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('secret-request-input')),
    );
  });

  it('a failed send expands a hidden stack and the chip dialog never reopens on its own', async () => {
    const agentId = 'agent-stack-failed';
    pending(agentId, ['sec-x1', 'KEY_ONE']);
    render(SecretRequestCards, {
      props: { transcript: transcriptFor(['sec-x1', 'KEY_ONE']), workspaceId: 'ws-1', agentId },
    });
    await fireEvent.click(screen.getByTestId('secret-request-hide'));
    await fireEvent.click(await screen.findByTestId('secret-request-chip-dismiss'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    appStore.dispatch(secretAnswerUpdated('sec-x1', 'sending', 1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    appStore.dispatch(secretAnswerUpdated('sec-x1', 'failed', 2));
    await waitFor(() => expect(screen.getByTestId('secret-request-card')).toBeTruthy());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the chip dismiss dialog when the chip moves to another request, without dismissing it', async () => {
    const agentId = 'agent-stack-retarget';
    const dispatch = vi.spyOn(appStore, 'dispatch');
    pending(agentId, ['sec-a', 'KEY_A']);
    const view = render(SecretRequestCards, {
      props: { transcript: transcriptFor(['sec-a', 'KEY_A']), workspaceId: 'ws-1', agentId },
    });
    await fireEvent.click(screen.getByTestId('secret-request-hide'));
    await fireEvent.click(await screen.findByTestId('secret-request-chip-dismiss'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Request A is replaced by B directly (A answered elsewhere, B asked);
    // B is a new card, so the stack expands and the dialog must close.
    pending(agentId, ['sec-b', 'KEY_B']);
    await view.rerender({
      transcript: transcriptFor(['sec-b', 'KEY_B']),
      workspaceId: 'ws-1',
      agentId,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('secret-request-card')).toHaveLength(1));
    // Hiding again for B must not resurrect a confirmation for B.
    await fireEvent.click(screen.getByTestId('secret-request-hide'));
    await screen.findByTestId('secret-request-chip');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      dispatch.mock.calls.some(
        ([action]) => (action as { type: string }).type === secretAnswerRequested.type,
      ),
    ).toBe(false);
  });

  it('closes the chip dismiss dialog when the panel switches to another agent', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    pending('agent-stack-one', ['sec-o1', 'KEY_ONE']);
    pending('agent-stack-two', ['sec-o1', 'KEY_ONE']);
    const view = render(SecretRequestCards, {
      props: {
        transcript: transcriptFor(['sec-o1', 'KEY_ONE']),
        workspaceId: 'ws-1',
        agentId: 'agent-stack-one',
      },
    });
    await fireEvent.click(screen.getByTestId('secret-request-hide'));
    await fireEvent.click(await screen.findByTestId('secret-request-chip-dismiss'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await view.rerender({
      transcript: transcriptFor(['sec-o1', 'KEY_ONE']),
      workspaceId: 'ws-1',
      agentId: 'agent-stack-two',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      dispatch.mock.calls.some(
        ([action]) => (action as { type: string }).type === secretAnswerRequested.type,
      ),
    ).toBe(false);
  });
});
