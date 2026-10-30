/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import {
  secretAnswerRequested,
  secretAnswerUpdated,
  secretRequestHidden,
} from '$store/renderer/slices/secret-requests/secret-requests-slice';
import SecretRequestCard from '../SecretRequestCard.svelte';
import { takeSecretValue } from '../secret-value-handoff';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';

const request = {
  requestId: 'sec-card-1',
  agentId: 'agent-a',
  name: 'OPENROUTER_API_KEY',
  reason: 'run tests',
};

function renderCard(state: 'pending' | 'expired' = 'pending', requestId = request.requestId) {
  return render(SecretRequestCard, {
    props: {
      request: { ...request, requestId },
      workspaceId: 'ws-1',
      agentId: 'agent-a',
      listedState: state,
    },
  });
}

beforeAll(() => appStore.init());
beforeEach(() => admitLegacyPrincipal());

describe('SecretRequestCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('masks the value and hands it off without putting it in any action or state', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    renderCard('pending', 'sec-card-provide');
    const input = screen.getByTestId('secret-request-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    await fireEvent.input(input, { target: { value: 's3cret' } });
    await fireEvent.click(screen.getByTestId('secret-request-provide'));
    const sent = dispatch.mock.calls.map(
      ([action]) => action as { type: string; payload?: unknown },
    );
    const answer = sent.find((action) => action.type === secretAnswerRequested.type);
    expect(answer?.payload).toEqual([
      {
        workspaceId: 'ws-1',
        agentId: 'agent-a',
        requestId: 'sec-card-provide',
        outcome: 'provided',
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('s3cret');
    expect(JSON.stringify(appStore.state)).not.toContain('s3cret');
    expect(takeSecretValue('sec-card-provide')).toBe('s3cret');
    appStore.dispatch(secretAnswerUpdated('sec-card-provide', 'provided', 1));
    await waitFor(() =>
      expect(screen.getByTestId('secret-request-card').dataset.state).toBe('provided'),
    );
    expect(screen.queryByTestId('secret-request-input')).toBeNull();
  });

  it('keeps the typed value for a retry when sending fails', async () => {
    renderCard('pending', 'sec-card-retry');
    const input = screen.getByTestId('secret-request-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'tok-123' } });
    await fireEvent.click(screen.getByTestId('secret-request-provide'));
    expect(takeSecretValue('sec-card-retry')).toBe('tok-123');
    appStore.dispatch(secretAnswerUpdated('sec-card-retry', 'failed', 1));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(input.value).toBe('tok-123');
    expect(input.disabled).toBe(false);
    expect(JSON.stringify(appStore.state)).not.toContain('tok-123');
    await fireEvent.click(screen.getByTestId('secret-request-reveal'));
    expect(input.type).toBe('text');
    appStore.dispatch(principalContextChanged(null));
    await waitFor(() => expect(input.value).toBe(''));
    expect(input.type).toBe('password');
    expect(input.disabled).toBe(true);
    admitLegacyPrincipal();
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(input.value).toBe('');
  });

  it('does not submit when Enter confirms an IME composition', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    renderCard('pending', 'sec-card-ime');
    const input = screen.getByTestId('secret-request-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'かぎ' } });
    await fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(
      dispatch.mock.calls.some(
        ([a]) => (a as { type: string }).type === secretAnswerRequested.type,
      ),
    ).toBe(false);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(
      dispatch.mock.calls.some(
        ([a]) => (a as { type: string }).type === secretAnswerRequested.type,
      ),
    ).toBe(true);
    takeSecretValue('sec-card-ime');
  });

  it('reveals the value only on request', async () => {
    renderCard('pending', 'sec-card-reveal');
    const input = screen.getByTestId('secret-request-input') as HTMLInputElement;
    await fireEvent.click(screen.getByTestId('secret-request-reveal'));
    expect(input.type).toBe('text');
    await fireEvent.click(screen.getByTestId('secret-request-reveal'));
    expect(input.type).toBe('password');
  });

  it('dismisses only after confirmation, without handing off a value', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    renderCard('pending', 'sec-card-decline');
    const answers = () =>
      dispatch.mock.calls
        .map(([action]) => action as { type: string; payload?: unknown[] })
        .filter((action) => action.type === secretAnswerRequested.type);
    await fireEvent.click(screen.getByTestId('secret-request-dismiss'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(answers()).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss request' }));
    expect(answers()).toHaveLength(1);
    expect(answers()[0]?.payload?.[0]).toMatchObject({
      requestId: 'sec-card-decline',
      outcome: 'declined',
    });
    expect(takeSecretValue('sec-card-decline')).toBeUndefined();
    appStore.dispatch(secretAnswerUpdated('sec-card-decline', 'declined', 1));
    await waitFor(() =>
      expect(screen.getByTestId('secret-request-card').dataset.state).toBe('declined'),
    );
    expect(screen.queryByTestId('secret-request-input')).toBeNull();
  });

  it('cancelling the dismiss confirmation sends nothing', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    renderCard('pending', 'sec-card-cancel');
    await fireEvent.click(screen.getByTestId('secret-request-dismiss'));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      dispatch.mock.calls.some(
        ([action]) => (action as { type: string }).type === secretAnswerRequested.type,
      ),
    ).toBe(false);
    await fireEvent.click(screen.getByTestId('secret-request-dismiss'));
    const retiredConfirm = screen.getByRole('button', { name: 'Dismiss request' });
    appStore.dispatch(principalContextChanged(null));
    await fireEvent.click(retiredConfirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      dispatch.mock.calls.some(
        ([action]) => (action as { type: string }).type === secretAnswerRequested.type,
      ),
    ).toBe(false);
  });

  it('Hide asks the stack to collapse', async () => {
    const onHide = vi.fn();
    render(SecretRequestCard, {
      props: {
        request: { ...request, requestId: 'sec-card-hide' },
        workspaceId: 'ws-1',
        agentId: 'agent-a',
        listedState: 'pending',
        onHide,
      },
    });
    await fireEvent.click(screen.getByTestId('secret-request-hide'));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('offers no input for an expired request, only a way to hide it', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    renderCard('expired', 'sec-card-expired');
    expect(screen.queryByTestId('secret-request-input')).toBeNull();
    expect(screen.queryByTestId('secret-request-provide')).toBeNull();
    await fireEvent.click(screen.getByTestId('secret-request-clear'));
    const hidden = dispatch.mock.calls
      .map(([action]) => action as { type: string; payload?: unknown[] })
      .find((action) => action.type === secretRequestHidden.type);
    expect(hidden?.payload).toEqual(['sec-card-expired']);
  });
});
