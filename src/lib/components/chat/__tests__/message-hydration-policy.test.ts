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

  it('starts eligible non-user messages as placeholders but keeps users hydrated', () => {
    const policy = createPolicy([assistant('a'), user('u'), assistant('b')]);
    expect(policy.getHydratedIds()).toEqual(['u']);
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

    expect(policy.getHydratedIds()).toEqual(['user-anchor']);
    observer.fire([{ target: elements.get('assistant-190')!, isIntersecting: true }]);
    expect(policy.getHydratedIds()).toEqual([
      'user-anchor',
      ...Array.from({ length: 10 }, (_, index) => `assistant-${index + 190}`),
    ]);
    transitions.length = 0;

    observer.fire([
      { target: elements.get('assistant-190')!, isIntersecting: false },
      { target: elements.get('assistant-195')!, isIntersecting: true },
    ]);

    expect(transitions).toEqual(
      Array.from({ length: 5 }, (_, index) => `dehydrate:assistant-${index + 190}`),
    );
    expect(policy.getHydratedIds()).toEqual([
      'user-anchor',
      ...Array.from({ length: 5 }, (_, index) => `assistant-${index + 195}`),
    ]);
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

  it('never dehydrates user messages and supports forced rows', () => {
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

    expect(policy.getHydratedIds()).toEqual(['user', 'forced', 'frontier']);
    expect(transitions).toEqual(['hydrate:forced', 'hydrate:frontier']);
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
    expect(observer.unobserve).toHaveBeenCalledWith(elements.get('a'));
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
});
