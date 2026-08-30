/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectLazyTurnObserverOwnership } from '../lazy-turn-observer';
import {
  createMessageHydrationPolicy,
  type HydrationMessage,
  type MessageHydrationPolicy,
} from '../message-hydration-policy';

const assistant = (id: string) => ({ id, role: 'assistant' as const });
const user = (id: string) => ({ id, role: 'user' as const });

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed = new Set<Element>();
  disconnect = vi.fn(() => this.observed.clear());
  unobserve = vi.fn((element: Element) => this.observed.delete(element));

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  fire(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

describe('message hydration policy', () => {
  const policies: MessageHydrationPolicy[] = [];

  beforeEach(() => {
    policies.length = 0;
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    policies.forEach((policy) => policy.dispose());
    expect(inspectLazyTurnObserverOwnership()).toEqual({ rootCount: 0, targetCount: 0 });
    vi.unstubAllGlobals();
  });

  function createPolicy(
    messages: readonly HydrationMessage[],
    onTransition: (transition: string) => void = () => {},
  ) {
    const policy = createMessageHydrationPolicy(messages, {
      onHydrate: (id) => onTransition(`hydrate:${id}`),
      onDehydrate: (id) => onTransition(`dehydrate:${id}`),
    });
    policies.push(policy);
    return policy;
  }

  function observe(policy: MessageHydrationPolicy, ids: readonly string[], root = document.body) {
    return new Map(
      ids.map((id) => {
        const element = document.createElement('div');
        policy.observe(id, element, root);
        return [id, element] as const;
      }),
    );
  }

  it('starts every row as a placeholder, user rows included', () => {
    const policy = createPolicy([assistant('a'), user('u'), assistant('b')]);
    expect(policy.getHydratedIds()).toEqual([]);
  });

  it('hydrates displayport rows and derives the oldest adjacent frontier', () => {
    const transitions: string[] = [];
    const policy = createPolicy(
      [assistant('old'), assistant('near'), assistant('new')],
      (transition) => transitions.push(transition),
    );
    const elements = observe(policy, ['old', 'near', 'new']);

    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('near')!, isIntersecting: true },
    ]);

    expect(transitions).toEqual(['hydrate:near', 'hydrate:new']);
    expect(policy.getHydratedIds()).toEqual(['near', 'new']);
  });

  it('retains newer hydrated rows while dehydrating only older rows', () => {
    const transitions: string[] = [];
    const policy = createPolicy(
      [assistant('old'), assistant('frontier'), assistant('new')],
      (transition) => transitions.push(transition),
    );
    const elements = observe(policy, ['old', 'frontier', 'new']);
    const observer = MockIntersectionObserver.instances[0];
    observer.fire([
      { target: elements.get('old')!, isIntersecting: true },
      { target: elements.get('frontier')!, isIntersecting: true },
      { target: elements.get('new')!, isIntersecting: true },
    ]);
    transitions.length = 0;

    observer.fire([
      { target: elements.get('old')!, isIntersecting: false },
      { target: elements.get('frontier')!, isIntersecting: true },
      { target: elements.get('new')!, isIntersecting: false },
    ]);

    expect(transitions).toEqual(['dehydrate:old']);
    expect(policy.getHydratedIds()).toEqual(['frontier', 'new']);
  });

  it('hydrates a newer placeholder added after the frontier is established', () => {
    const transitions: string[] = [];
    const policy = createPolicy([assistant('frontier')], (transition) =>
      transitions.push(transition),
    );
    const elements = observe(policy, ['frontier']);
    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('frontier')!, isIntersecting: true },
    ]);
    transitions.length = 0;

    policy.updateMessages([assistant('frontier'), assistant('new')]);

    expect(transitions).toEqual(['hydrate:new']);
    expect(policy.getHydratedIds()).toEqual(['frontier', 'new']);
  });

  it('keeps newer rows hydrated while scrolling toward the tail of a long transcript', () => {
    const messages = Array.from({ length: 200 }, (_, index) =>
      index === 20 ? user('user-anchor') : assistant(`assistant-${index}`),
    );
    const transitions: string[] = [];
    const policy = createPolicy(messages, (transition) => transitions.push(transition));
    const elements = observe(policy, ['assistant-190', 'assistant-195']);
    const observer = MockIntersectionObserver.instances[0];

    expect(policy.getHydratedIds()).toEqual([]);
    observer.fire([{ target: elements.get('assistant-190')!, isIntersecting: true }]);
    expect(policy.getHydratedIds()).toEqual(
      Array.from({ length: 10 }, (_, index) => `assistant-${index + 190}`),
    );
    transitions.length = 0;

    observer.fire([
      { target: elements.get('assistant-190')!, isIntersecting: false },
      { target: elements.get('assistant-195')!, isIntersecting: true },
    ]);

    expect(transitions).toEqual(
      Array.from({ length: 5 }, (_, index) => `dehydrate:assistant-${index + 190}`),
    );
    expect(policy.getHydratedIds()).toEqual(
      Array.from({ length: 5 }, (_, index) => `assistant-${index + 195}`),
    );
  });

  it('makes mixed observer entry/exit ordering deterministic and enter-safe', () => {
    const firstTransitions: string[] = [];
    const secondTransitions: string[] = [];
    const first = createPolicy([assistant('old'), assistant('new')], (transition) =>
      firstTransitions.push(transition),
    );
    const firstElements = observe(first, ['old', 'new'], document.createElement('div'));
    const second = createPolicy([assistant('old'), assistant('new')], (transition) =>
      secondTransitions.push(transition),
    );
    const secondElements = observe(second, ['old', 'new'], document.createElement('div'));
    const [firstObserver, secondObserver] = MockIntersectionObserver.instances;
    firstObserver.fire([{ target: firstElements.get('old')!, isIntersecting: true }]);
    secondObserver.fire([{ target: secondElements.get('old')!, isIntersecting: true }]);
    firstTransitions.length = 0;
    secondTransitions.length = 0;

    firstObserver.fire([
      { target: firstElements.get('old')!, isIntersecting: false },
      { target: firstElements.get('new')!, isIntersecting: true },
    ]);
    secondObserver.fire([
      { target: secondElements.get('new')!, isIntersecting: true },
      { target: secondElements.get('old')!, isIntersecting: false },
    ]);

    expect(firstTransitions).toEqual(['dehydrate:old']);
    expect(secondTransitions).toEqual(firstTransitions);
    expect(first.getHydratedIds()).toEqual(second.getHydratedIds());
  });

  it('keeps user rows above the frontier as placeholders and supports forced rows', () => {
    const transitions: string[] = [];
    const policy = createPolicy(
      [user('user'), assistant('forced'), assistant('frontier')],
      (transition) => transitions.push(transition),
    );
    policy.setForced('forced', true);
    const elements = observe(policy, ['frontier']);
    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('frontier')!, isIntersecting: true },
    ]);

    expect(policy.getHydratedIds()).toEqual(['forced', 'frontier']);
    expect(transitions).toEqual(['hydrate:forced', 'hydrate:frontier']);
  });

  it('never dehydrates a user row once it has hydrated', () => {
    const transitions: string[] = [];
    const policy = createPolicy([user('u'), assistant('a'), assistant('b')], (transition) =>
      transitions.push(transition),
    );
    const elements = observe(policy, ['u', 'a', 'b']);
    const observer = MockIntersectionObserver.instances[0];
    observer.fire([
      { target: elements.get('u')!, isIntersecting: true },
      { target: elements.get('a')!, isIntersecting: true },
      { target: elements.get('b')!, isIntersecting: true },
    ]);
    expect(policy.getHydratedIds()).toEqual(['u', 'a', 'b']);
    transitions.length = 0;

    // Scrolling down moves the frontier past both older rows: the assistant
    // row dehydrates, the user row stays (pinned-prompt/nav DOM anchor).
    observer.fire([
      { target: elements.get('u')!, isIntersecting: false },
      { target: elements.get('a')!, isIntersecting: false },
      { target: elements.get('b')!, isIntersecting: true },
    ]);

    expect(transitions).toEqual(['dehydrate:a']);
    expect(policy.getHydratedIds()).toEqual(['u', 'b']);
  });

  it('eagerly hydrates appended rows but not interior insertions or prepends', () => {
    const transitions: string[] = [];
    const policy = createPolicy([assistant('a')], (transition) => transitions.push(transition));

    // Appended past every known row (a just-sent user message): hydrates
    // immediately without waiting for an intersection report.
    policy.updateMessages([assistant('a'), user('sent')]);
    expect(transitions).toEqual(['hydrate:sent']);
    transitions.length = 0;

    // Older-history prepend: stays a placeholder.
    policy.updateMessages([user('prepended'), assistant('a'), user('sent')]);
    expect(transitions).toEqual([]);
    expect(policy.getHydratedIds()).toEqual(['sent']);
  });

  it('cleans up removed rows, callbacks, and all state on dispose', () => {
    const transitions: string[] = [];
    const policy = createPolicy([assistant('a'), assistant('b')], (transition) =>
      transitions.push(transition),
    );
    const elements = observe(policy, ['a', 'b']);
    const observer = MockIntersectionObserver.instances[0];
    observer.fire([{ target: elements.get('a')!, isIntersecting: true }]);
    expect(transitions).toEqual(['hydrate:a', 'hydrate:b']);

    policy.updateMessages([assistant('b')]);
    // Mounted registrations survive a list omission (the component's unmount
    // cleanup owns release) so a republished row can still report visibility.
    expect(observer.unobserve).not.toHaveBeenCalledWith(elements.get('a'));
    expect(policy.getHydratedIds()).toEqual(['b']);
    policy.dispose();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(policy.getHydratedIds()).toEqual([]);

    transitions.length = 0;
    policy.setForced('b', true);
    policy.updateMessages([assistant('b')]);
    observer.fire([{ target: elements.get('b')!, isIntersecting: true }]);
    expect(transitions).toEqual([]);
    expect(policy.getHydratedIds()).toEqual([]);
  });

  it('replays a visibility report that arrives before updateMessages installs the record', () => {
    const transitions: string[] = [];
    const policy = createPolicy([], (transition) => transitions.push(transition));
    const elements = observe(policy, ['a']);

    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('a')!, isIntersecting: true },
    ]);
    policy.updateMessages([assistant('a'), assistant('b')]);

    expect(transitions).toEqual(['hydrate:a', 'hydrate:b']);
    expect(policy.getHydratedIds()).toEqual(['a', 'b']);
  });

  it('keeps a pre-record non-intersecting report from hydrating an offscreen row', () => {
    const policy = createPolicy([]);
    const elements = observe(policy, ['a']);

    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('a')!, isIntersecting: false },
    ]);
    policy.updateMessages([assistant('a')]);

    expect(policy.getHydratedIds()).toEqual([]);
  });

  it('hydrates intersecting rows reported between setActive re-attach and updateMessages', () => {
    const policy = createPolicy([]);
    policy.setActive(false);
    const elements = observe(policy, ['a']);

    policy.setActive(true);
    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('a')!, isIntersecting: true },
    ]);
    policy.updateMessages([assistant('a')]);

    expect(policy.getHydratedIds()).toEqual(['a']);
  });

  it('drops a retained pre-record report when observation deactivates', () => {
    const policy = createPolicy([]);
    const elements = observe(policy, ['a']);
    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('a')!, isIntersecting: true },
    ]);

    policy.setActive(false);
    policy.setActive(true);
    policy.updateMessages([assistant('a')]);

    expect(policy.getHydratedIds()).toEqual([]);

    MockIntersectionObserver.instances[1].fire([
      { target: elements.get('a')!, isIntersecting: true },
    ]);
    expect(policy.getHydratedIds()).toEqual(['a']);
  });

  it('detaches visibility observers while inactive and restores registrations', () => {
    const policy = createPolicy([assistant('a')]);
    const elements = observe(policy, ['a']);
    const firstObserver = MockIntersectionObserver.instances[0];

    policy.setActive(false);
    expect(firstObserver.disconnect).toHaveBeenCalledOnce();

    policy.setActive(true);
    expect(MockIntersectionObserver.instances).toHaveLength(2);
    MockIntersectionObserver.instances[1].fire([
      { target: elements.get('a')!, isIntersecting: true },
    ]);
    expect(policy.getHydratedIds()).toEqual(['a']);
  });

  it('restores observation for a row whose message transiently leaves the list while mounted', () => {
    const policy = createPolicy([assistant('a'), assistant('b')]);
    const elements = observe(policy, ['a', 'b']);
    const observer = MockIntersectionObserver.instances[0];
    observer.fire([{ target: elements.get('b')!, isIntersecting: true }]);
    expect(policy.getHydratedIds()).toEqual(['b']);

    // Transcript recomposition transiently omits 'a' while its row (and thus
    // its registration) stays mounted, then republishes it.
    policy.updateMessages([assistant('b')]);
    policy.updateMessages([assistant('a'), assistant('b')]);

    // The row scrolls into the viewport: the observation restored on
    // republish must deliver this report, or the row is a permanent blank
    // placeholder despite occupying the viewport.
    observer.fire([{ target: elements.get('a')!, isIntersecting: true }]);
    expect(policy.getHydratedIds()).toEqual(['a', 'b']);
  });

  it('keeps an on-screen row hydrated when a streaming-churn batch carries out-and-back-in entries', () => {
    const messages = Array.from({ length: 12 }, (_, index) => assistant(`m${index}`));
    const transitions: string[] = [];
    const policy = createPolicy(messages, (transition) => transitions.push(transition));
    const elements = observe(policy, ['m8', 'm9', 'm10', 'm11']);
    const observer = MockIntersectionObserver.instances[0];
    observer.fire([
      { target: elements.get('m8')!, isIntersecting: true },
      { target: elements.get('m9')!, isIntersecting: true },
      { target: elements.get('m10')!, isIntersecting: true },
      { target: elements.get('m11')!, isIntersecting: true },
    ]);
    expect(policy.getHydratedIds()).toEqual(['m8', 'm9', 'm10', 'm11']);
    transitions.length = 0;

    // Streaming appends a new tail message...
    policy.updateMessages([...messages, assistant('m12')]);
    // ...and its layout churn makes the frontier row cross out and back in
    // between observer deliveries: ONE batch carries both crossings in
    // chronological order, ending intersecting. The row is still on screen,
    // so no further boundary crossing will ever correct a stale final state.
    observer.fire([
      { target: elements.get('m8')!, isIntersecting: false },
      { target: elements.get('m8')!, isIntersecting: true },
    ]);

    expect(transitions).not.toContain('dehydrate:m8');
    expect(policy.getHydratedIds()).toContain('m8');
  });

  it('releases a retained registration via observe() cleanup on unmount and supports re-registration', () => {
    const policy = createPolicy([assistant('a'), assistant('b')]);
    const elementA = document.createElement('div');
    const cleanupA = policy.observe('a', elementA, document.body);
    const elements = observe(policy, ['b']);
    const observer = MockIntersectionObserver.instances[0];
    observer.fire([
      { target: elementA, isIntersecting: true },
      { target: elements.get('b')!, isIntersecting: true },
    ]);
    expect(policy.getHydratedIds()).toEqual(['a', 'b']);

    // Transient omission retains the registration (updateMessages never
    // releases; observe()'s cleanup is the only pre-dispose release path).
    policy.updateMessages([assistant('b')]);
    expect(observer.unobserve).not.toHaveBeenCalledWith(elementA);
    expect(inspectLazyTurnObserverOwnership().targetCount).toBe(2);

    // Genuine unmount: the stored cleanup releases the retained registration.
    cleanupA();
    expect(observer.unobserve).toHaveBeenCalledWith(elementA);
    expect(inspectLazyTurnObserverOwnership().targetCount).toBe(1);

    // The id republishes onto a fresh registration and reports visibility.
    policy.updateMessages([assistant('a'), assistant('b')]);
    const freshElementA = document.createElement('div');
    policy.observe('a', freshElementA, document.body);
    expect(inspectLazyTurnObserverOwnership().targetCount).toBe(2);
    observer.fire([{ target: freshElementA, isIntersecting: true }]);
    expect(policy.getHydratedIds()).toEqual(['a', 'b']);
  });

  it('hydrates viewport rows after detach/re-attach when fresh reports cover only those rows', () => {
    const messages = ['a0', 'a1', 'a2', 'a3', 'a4'].map(assistant);
    const policy = createPolicy(messages);
    const elements = observe(policy, ['a0', 'a1', 'a2', 'a3', 'a4']);
    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('a3')!, isIntersecting: true },
      { target: elements.get('a4')!, isIntersecting: true },
    ]);
    expect(policy.getHydratedIds()).toEqual(['a3', 'a4']);

    policy.setActive(false);
    policy.setActive(true);
    // ChatPanel reactivation replays the message list before fresh reports.
    policy.updateMessages(messages);

    // Fresh reports arrive only for the rows now occupying the viewport.
    MockIntersectionObserver.instances[1].fire([
      { target: elements.get('a0')!, isIntersecting: true },
      { target: elements.get('a1')!, isIntersecting: true },
    ]);
    expect(policy.getHydratedIds()).toEqual(expect.arrayContaining(['a0', 'a1']));
  });
});
