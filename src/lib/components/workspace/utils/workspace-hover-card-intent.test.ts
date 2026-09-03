import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceHoverCardIntentSession,
  WORKSPACE_HOVER_CARD_OPEN_DELAY_MS,
  WORKSPACE_HOVER_CARD_SESSION_RESET_DELAY_MS,
} from './workspace-hover-card-intent';

describe('workspace hover-card intent session', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the initial delay until a card opens', () => {
    const session = createWorkspaceHoverCardIntentSession();

    expect(session.currentOpenDelay).toBe(WORKSPACE_HOVER_CARD_OPEN_DELAY_MS);
    session.notifyOpened();
    expect(session.currentOpenDelay).toBe(0);
  });

  it('returns to the initial delay only after the close cooldown', () => {
    vi.useFakeTimers();
    const session = createWorkspaceHoverCardIntentSession();

    session.notifyOpened();
    session.notifyClosed();
    vi.advanceTimersByTime(WORKSPACE_HOVER_CARD_SESSION_RESET_DELAY_MS - 1);
    expect(session.currentOpenDelay).toBe(0);
    vi.advanceTimersByTime(1);
    expect(session.currentOpenDelay).toBe(WORKSPACE_HOVER_CARD_OPEN_DELAY_MS);
  });

  it('cancels the reset when another card opens during cooldown', () => {
    vi.useFakeTimers();
    const session = createWorkspaceHoverCardIntentSession();

    session.notifyOpened();
    session.notifyClosed();
    vi.advanceTimersByTime(WORKSPACE_HOVER_CARD_SESSION_RESET_DELAY_MS - 1);
    session.notifyOpened();
    vi.advanceTimersByTime(WORKSPACE_HOVER_CARD_SESSION_RESET_DELAY_MS);
    expect(session.currentOpenDelay).toBe(0);

    session.notifyClosed();
    vi.advanceTimersByTime(WORKSPACE_HOVER_CARD_SESSION_RESET_DELAY_MS);
    expect(session.currentOpenDelay).toBe(WORKSPACE_HOVER_CARD_OPEN_DELAY_MS);
  });
});
