import { describe, expect, it, vi } from 'vitest';
import {
  createMessageHydrationPolicy,
  deriveMessageHydrationFrontier,
  shouldStartAsMessagePlaceholder,
} from '../message-hydration-policy';

const assistant = (id: string) => ({ id, role: 'assistant' as const });
const user = (id: string) => ({ id, role: 'user' as const });

describe('message hydration policy', () => {
  it('starts eligible non-user messages as placeholders but keeps users hydrated', () => {
    expect(shouldStartAsMessagePlaceholder(assistant('a'))).toBe(true);
    expect(shouldStartAsMessagePlaceholder(user('u'))).toBe(false);
    const policy = createMessageHydrationPolicy([assistant('a'), user('u'), assistant('b')]);
    expect(policy.getHydratedIds()).toEqual(['u']);
  });

  it('hydrates displayport rows and derives the oldest adjacent frontier', () => {
    const policy = createMessageHydrationPolicy([
      assistant('old'),
      assistant('near'),
      assistant('new'),
    ]);
    expect(policy.reportVisibility('near', true)).toEqual([
      { id: 'near', hydrated: true, reason: 'displayport' },
    ]);
    expect(policy.getFrontier()).toBe('near');
    expect(deriveMessageHydrationFrontier(policy.getStates(), ['new', 'near'])).toBe('near');
  });

  it('retains newer hydrated rows while dehydrating only older rows', () => {
    const policy = createMessageHydrationPolicy([
      assistant('old'),
      assistant('frontier'),
      assistant('new'),
    ]);
    policy.reportVisibility('old', true);
    policy.reportVisibility('frontier', true);
    policy.reportVisibility('new', true);
    const transitions = policy.reportObserverEntries([
      { id: 'old', isIntersecting: false },
      { id: 'frontier', isIntersecting: true },
      { id: 'new', isIntersecting: false },
    ]);
    expect(transitions).toEqual([{ id: 'old', hydrated: false, reason: 'dehydrate' }]);
    expect(policy.getHydratedIds()).toEqual(['frontier', 'new']);
    expect(policy.getState('new')?.canDehydrate).toBe(false);
  });

  it('makes mixed observer entry/exit ordering deterministic and enter-safe', () => {
    const first = createMessageHydrationPolicy([assistant('old'), assistant('new')]);
    const second = createMessageHydrationPolicy([assistant('old'), assistant('new')]);
    first.reportVisibility('old', true);
    second.reportVisibility('old', true);
    const entries = [
      { id: 'old', isIntersecting: false },
      { id: 'new', isIntersecting: true },
    ];
    first.reportObserverEntries(entries);
    second.reportObserverEntries([...entries].reverse());
    expect(first.getFrontier()).toBe('new');
    expect(second.getFrontier()).toBe('new');
    expect(first.getHydratedIds()).toEqual(second.getHydratedIds());
  });

  it('never dehydrates user messages and supports forced rows', () => {
    const policy = createMessageHydrationPolicy(
      [user('user'), assistant('old'), assistant('forced')],
      { forcedMessageIds: ['forced'] },
    );
    policy.reportVisibility('forced', true);
    policy.reportVisibility('user', true);
    policy.reportObserverEntries([
      { id: 'user', isIntersecting: false },
      { id: 'forced', isIntersecting: false },
    ]);
    expect(policy.getHydratedIds()).toEqual(['user', 'forced']);
  });

  it('cleans up removed rows, callbacks, and all state on dispose', () => {
    const onHydrate = vi.fn();
    const policy = createMessageHydrationPolicy([assistant('a'), assistant('b')], { onHydrate });
    policy.reportVisibility('a', true);
    expect(onHydrate).toHaveBeenCalledWith('a');
    policy.removeMessage('a');
    expect(policy.getState('a')).toBeUndefined();
    policy.dispose();
    expect(policy.getStates()).toEqual([]);
    expect(policy.reportVisibility('b', true)).toEqual([]);
    expect(policy.getFrontier()).toBeUndefined();
  });
});
