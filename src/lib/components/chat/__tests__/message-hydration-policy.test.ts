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

  it('eagerly hydrates a newer row appended after the frontier is established', () => {
    const transitions: string[] = [];
    const policy = createPolicy([assistant('frontier')], (transition) =>
      transitions.push(transition),
    );
    const elements = observe(policy, ['frontier']);
    MockIntersectionObserver.instances[0].fire([
      { target: elements.get('frontier')!, isIntersecting: true },
    ]);
    transitions.length = 0;

    // The appended row hydrates via the eager-append tail window, not the
    // frontier (which never hydrates).
    policy.updateMessages([assistant('frontier'), assistant('new')]);

    expect(transitions).toEqual(['hydrate:new']);
    expect(policy.getHydratedIds()).toEqual(['frontier', 'new']);
  });

  it('keeps newer hydrated rows and dehydrates older ones while scrolling toward the tail', () => {
    const messages = Array.from({ length: 200 }, (_, index) =>
      index === 20 ? user('user-anchor') : assistant(`assistant-${index}`),
    );
    const transitions: string[] = [];
    const policy = createPolicy(messages, (transition) => transitions.push(transition));
    const elements = observe(policy, ['assistant-190', 'assistant-195']);
    const observer = MockIntersectionObserver.instances[0];

    expect(policy.getHydratedIds()).toEqual([]);
    // Both rows enter the preload band while scrolling down: only the
    // intersecting rows hydrate, never their unseen neighbors.
    observer.fire([
      { target: elements.get('assistant-190')!, isIntersecting: true },
      { target: elements.get('assistant-195')!, isIntersecting: true },
    ]);
    expect(policy.getHydratedIds()).toEqual(['assistant-190', 'assistant-195']);
    transitions.length = 0;

    // The older row leaves the band: the frontier moves to the newer row and
    // only the older row dehydrates.
    observer.fire([{ target: elements.get('assistant-190')!, isIntersecting: false }]);

    expect(transitions).toEqual(['dehydrate:assistant-190']);
    expect(policy.getHydratedIds()).toEqual(['assistant-195']);
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

    expect(firstTransitions).toEqual(['hydrate:new', 'dehydrate:old']);
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
    const policy = createPolicy([assistant('a'), assistant('b')], (transition) =>
      transitions.push(transition),
    );

    // Appended past every known row (a just-sent user message): hydrates
    // immediately without waiting for an intersection report.
    policy.updateMessages([assistant('a'), assistant('b'), user('sent')]);
    expect(transitions).toEqual(['hydrate:sent']);
    transitions.length = 0;

    // Interior insertion (a new id between two known ids): stays a
    // placeholder — it is not newer than every previously known row.
    policy.updateMessages([assistant('a'), assistant('inserted'), assistant('b'), user('sent')]);
    expect(transitions).toEqual([]);

    // Older-history prepend: stays a placeholder.
    policy.updateMessages([
      user('prepended'),
      assistant('a'),
      assistant('inserted'),
      assistant('b'),
      user('sent'),
    ]);
    expect(transitions).toEqual([]);
    expect(policy.getHydratedIds()).toEqual(['sent']);
  });

  it('installs the first transcript into an empty policy fully dehydrated', () => {
    const transitions: string[] = [];
    // The production path: ChatPanel constructs the policy with [] and the
    // first updateMessages carries the whole transcript — nothing may
    // hydrate eagerly or a workspace switch mounts everything synchronously.
    const policy = createPolicy([], (transition) => transitions.push(transition));

    policy.updateMessages(
      Array.from({ length: 200 }, (_, index) =>
        index % 2 === 0 ? user(`u${index}`) : assistant(`a${index}`),
      ),
    );

    expect(transitions).toEqual([]);
    expect(policy.getHydratedIds()).toEqual([]);
  });

  it('caps eager hydration of a large append backlog to a small tail window', () => {
    const transitions: string[] = [];
    const policy = createPolicy([assistant('a')], (transition) => transitions.push(transition));

    // A panel reactivating after heavy background chatter delivers the whole
    // backlog as one append past the surviving row. Only a small trailing
    // window hydrates eagerly; the rest stay placeholders for the
    // observer/frontier, so switch-back cost is O(cap), not O(backlog).
    const backlog = Array.from({ length: 150 }, (_, index) =>
      index % 2 === 0 ? assistant(`bg${index}`) : user(`bg${index}`),
    );
    policy.updateMessages([assistant('a'), ...backlog]);

    expect(transitions.length).toBeLessThanOrEqual(10);
    // The eager window is the newest tail of the list.
    const hydrated = policy.getHydratedIds();
    expect(hydrated).toEqual(backlog.slice(-hydrated.length).map((message) => message.id));
    expect(hydrated[hydrated.length - 1]).toBe('bg149');
  });

  it('reports appended rows via getHydratedIds from inside onHydrate', () => {
    const seenDuringCallback: string[][] = [];
    const policy = createMessageHydrationPolicy([assistant('a')], {
      onHydrate: () => seenDuringCallback.push(policy.getHydratedIds()),
    });
    policies.push(policy);

    policy.updateMessages([assistant('a'), user('sent')]);

    // The record must be committed before the callback fires so a consumer
    // reading getHydratedIds inside onHydrate sees the row it was told about.
    expect(seenDuringCallback).toEqual([['sent']]);
  });

  it('starts a full transcript replacement as placeholders, never append-eager', () => {
    const transitions: string[] = [];
    const policy = createPolicy([user('old-u'), assistant('old-a')], (transition) =>
      transitions.push(transition),
    );

    // A rebound panel publishing a disjoint id set (workspace/agent switch
    // without an intervening empty list) shares no ids with the previous
    // records: no row may hydrate eagerly, or the whole replacement
    // transcript mounts synchronously — the workspace-switch stall.
    policy.updateMessages(
      Array.from({ length: 50 }, (_, index) =>
        index % 2 === 0 ? user(`next-u${index}`) : assistant(`next-a${index}`),
      ),
    );

    expect(transitions).toEqual([]);
    expect(policy.getHydratedIds()).toEqual([]);
  });

  it('cleans up removed rows, callbacks, and all state on dispose', () => {
    const transitions: string[] = [];
    const policy = createPolicy([assistant('a'), assistant('b')], (transition) =>
      transitions.push(transition),
    );
    const elements = observe(policy, ['a', 'b']);
    const observer = MockIntersectionObserver.instances[0];
    observer.fire([
      { target: elements.get('a')!, isIntersecting: true },
      { target: elements.get('b')!, isIntersecting: true },
    ]);
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

    // The replayed report hydrates only the reported row; its unseen newer
    // neighbor stays a placeholder (the frontier never hydrates).
    expect(transitions).toEqual(['hydrate:a']);
    expect(policy.getHydratedIds()).toEqual(['a']);
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

  describe('workspace-switch mass hydration regression', () => {
    // Guards against the ~1s workspace-switch flush: on a transcript scrolled
    // away from the bottom, the observer reports only the rows near the
    // scroll position and the frontier lands on an OLD row. The frontier is a
    // retention barrier, never a hydration trigger — it must not hydrate the
    // newer rows the user has never seen.
    it('does not hydrate unseen rows newer than the frontier on a scrolled-up transcript', () => {
      const messages = Array.from({ length: 200 }, (_, index) => assistant(`assistant-${index}`));
      const transitions: string[] = [];
      const policy = createPolicy(messages, (transition) => transitions.push(transition));
      // Only the rows around the restored scroll position (near the top of
      // the transcript) mount into the viewport and report intersection.
      const elements = observe(policy, ['assistant-40', 'assistant-41', 'assistant-42']);

      MockIntersectionObserver.instances[0].fire([
        { target: elements.get('assistant-40')!, isIntersecting: true },
        { target: elements.get('assistant-41')!, isIntersecting: true },
        { target: elements.get('assistant-42')!, isIntersecting: true },
      ]);

      // Rows 43..199 were never intersecting and never hydrated: the frontier
      // is a retention barrier, not a hydration trigger, so they must stay
      // placeholders instead of mounting in one synchronous pass.
      expect(policy.getHydratedIds()).toEqual(['assistant-40', 'assistant-41', 'assistant-42']);
      expect(transitions).toEqual([
        'hydrate:assistant-40',
        'hydrate:assistant-41',
        'hydrate:assistant-42',
      ]);
    });

    it('retains an already-hydrated row newer than the frontier after it leaves the preload band', () => {
      const messages = Array.from({ length: 200 }, (_, index) => assistant(`assistant-${index}`));
      const transitions: string[] = [];
      const policy = createPolicy(messages, (transition) => transitions.push(transition));
      const elements = observe(policy, ['assistant-40', 'assistant-150']);
      const observer = MockIntersectionObserver.instances[0];

      // The row hydrates by intersecting, then exits the preload band while
      // the frontier moves to an older row (user scrolled up).
      observer.fire([{ target: elements.get('assistant-150')!, isIntersecting: true }]);
      expect(policy.getHydratedIds()).toContain('assistant-150');

      observer.fire([
        { target: elements.get('assistant-150')!, isIntersecting: false },
        { target: elements.get('assistant-40')!, isIntersecting: true },
      ]);

      // Newer than the frontier and previously hydrated: retained, so
      // scrolling back down never flashes a placeholder.
      expect(transitions).not.toContain('dehydrate:assistant-150');
      expect(policy.getHydratedIds()).toContain('assistant-150');
    });

    it('eagerly hydrates exactly the MAX_EAGER_APPEND_ROWS tail of a large append', () => {
      const transitions: string[] = [];
      const policy = createPolicy([assistant('seed')], (transition) =>
        transitions.push(transition),
      );

      const backlog = Array.from({ length: 40 }, (_, index) => assistant(`appended-${index}`));
      policy.updateMessages([assistant('seed'), ...backlog]);

      // The eager window is the trailing MAX_EAGER_APPEND_ROWS (8) rows of
      // the list; everything before it stays a placeholder.
      expect(policy.getHydratedIds()).toEqual(backlog.slice(-8).map((message) => message.id));
      expect(transitions).toEqual(backlog.slice(-8).map((message) => `hydrate:${message.id}`));
    });
  });

  describe('batched hydration notifications', () => {
    it('fires onHydrationChange once per updateMessages call, after all transitions commit', () => {
      const snapshots: string[][] = [];
      const policy = createMessageHydrationPolicy([assistant('a'), assistant('b')], {
        onHydrationChange: () => snapshots.push(policy.getHydratedIds()),
      });
      policies.push(policy);

      // Several eager-append transitions in one call coalesce into a single
      // notification carrying the committed net state.
      policy.updateMessages([assistant('a'), assistant('b'), user('s1'), assistant('s2')]);
      expect(snapshots).toEqual([['s1', 's2']]);

      // A call that transitions nothing does not notify.
      policy.updateMessages([assistant('a'), assistant('b'), user('s1'), assistant('s2')]);
      expect(snapshots).toHaveLength(1);
    });

    it('notifies once for a visibility report that both hydrates and dehydrates rows', () => {
      const snapshots: string[][] = [];
      const policy = createMessageHydrationPolicy([assistant('a'), assistant('b')], {
        onHydrationChange: () => snapshots.push(policy.getHydratedIds()),
      });
      policies.push(policy);
      const elements = observe(policy, ['a', 'b']);
      const observer = MockIntersectionObserver.instances[0];

      observer.fire([{ target: elements.get('a')!, isIntersecting: true }]);
      observer.fire([{ target: elements.get('a')!, isIntersecting: false }]);
      snapshots.length = 0;

      // One report moves the frontier to 'b': 'b' hydrates and 'a' dehydrates
      // in the same reconcile pass — a single notification with the net state.
      observer.fire([{ target: elements.get('b')!, isIntersecting: true }]);

      expect(snapshots).toEqual([['b']]);
    });

    it('notifies once per observer delivery, not once per entry', () => {
      const messages = Array.from({ length: 8 }, (_, index) => assistant(`m${index}`));
      const snapshots: string[][] = [];
      const policy = createMessageHydrationPolicy(messages, {
        onHydrationChange: () => snapshots.push(policy.getHydratedIds()),
      });
      policies.push(policy);
      const elements = observe(policy, ['m2', 'm3', 'm4', 'm5']);

      // A single IntersectionObserver delivery carries k entries and invokes
      // the per-row report path k times — the flush defers to delivery end so
      // the consumer rebuilds derived state ONCE with the committed net state.
      MockIntersectionObserver.instances[0].fire([
        { target: elements.get('m2')!, isIntersecting: true },
        { target: elements.get('m3')!, isIntersecting: true },
        { target: elements.get('m4')!, isIntersecting: true },
        { target: elements.get('m5')!, isIntersecting: true },
      ]);

      expect(snapshots).toEqual([['m2', 'm3', 'm4', 'm5']]);
    });
  });

  describe('frame-budgeted hydration', () => {
    function controlledFrames() {
      const callbacks: FrameRequestCallback[] = [];
      return {
        callbacks,
        scheduleFrame: (callback: FrameRequestCallback) => {
          callbacks.push(callback);
          return callbacks.length;
        },
        cancelFrame: vi.fn(),
      };
    }

    it('paints chrome first, then prioritizes visible rows within the numeric frame budget', () => {
      const frames = controlledFrames();
      let clock = 0;
      const transitions: string[] = [];
      const policy = createMessageHydrationPolicy(
        [
          assistant('preload-1'),
          assistant('visible-1'),
          assistant('visible-2'),
          assistant('preload-2'),
        ],
        {
          frameBudgetMs: 6,
          maxRowsPerFrame: 4,
          scheduleFrame: frames.scheduleFrame,
          cancelFrame: frames.cancelFrame,
          now: () => clock,
          onHydrate: (id) => {
            transitions.push(id);
            clock += 3;
          },
        },
      );
      policies.push(policy);
      const root = document.createElement('div');
      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
      const elements = observe(policy, ['preload-1', 'visible-1', 'visible-2', 'preload-2'], root);

      MockIntersectionObserver.instances[0].callback(
        [
          {
            target: elements.get('preload-1')!,
            isIntersecting: true,
            boundingClientRect: { top: 20, bottom: 80 },
          },
          {
            target: elements.get('visible-1')!,
            isIntersecting: true,
            boundingClientRect: { top: 120, bottom: 180 },
          },
          {
            target: elements.get('visible-2')!,
            isIntersecting: true,
            boundingClientRect: { top: 190, bottom: 250 },
          },
          {
            target: elements.get('preload-2')!,
            isIntersecting: true,
            boundingClientRect: { top: 320, bottom: 380 },
          },
        ] as IntersectionObserverEntry[],
        MockIntersectionObserver.instances[0] as unknown as IntersectionObserver,
      );

      expect(policy.getHydratedIds()).toEqual([]);
      expect(frames.callbacks).toHaveLength(1);
      frames.callbacks[0](0);
      expect(transitions).toEqual(['visible-1', 'visible-2']);
      expect(policy.getHydratedIds()).toEqual(['visible-1', 'visible-2']);
      expect(frames.callbacks).toHaveLength(2);
    });

    it('rejects a stale scheduled frame after scope replacement', () => {
      const frames = controlledFrames();
      const transitions: string[] = [];
      const policy = createMessageHydrationPolicy([assistant('old')], {
        frameBudgetMs: 6,
        maxRowsPerFrame: 4,
        scheduleFrame: frames.scheduleFrame,
        cancelFrame: frames.cancelFrame,
        now: () => 0,
        onHydrate: (id) => transitions.push(id),
      });
      policies.push(policy);
      policy.setScope('workspace-a:agent-a');
      policy.updateMessages([assistant('old')]);
      const oldElement = observe(policy, ['old']).get('old')!;
      MockIntersectionObserver.instances
        .at(-1)!
        .fire([{ target: oldElement, isIntersecting: true }]);
      const staleFrame = frames.callbacks[0];

      policy.setScope('workspace-b:agent-b');
      policy.updateMessages([assistant('new')]);
      policy.setForced('new', true);
      staleFrame(0);

      expect(frames.cancelFrame).toHaveBeenCalled();
      expect(transitions).toEqual(['new']);
      expect(policy.getHydratedIds()).toEqual(['new']);
    });

    it('rejects queued hydration after deactivation', () => {
      const frames = controlledFrames();
      const transitions: string[] = [];
      const policy = createMessageHydrationPolicy([assistant('row')], {
        frameBudgetMs: 6,
        scheduleFrame: frames.scheduleFrame,
        cancelFrame: frames.cancelFrame,
        now: () => 0,
        onHydrate: (id) => transitions.push(id),
      });
      policies.push(policy);
      const element = observe(policy, ['row']).get('row')!;
      MockIntersectionObserver.instances[0].fire([{ target: element, isIntersecting: true }]);
      const staleFrame = frames.callbacks[0];

      policy.setActive(false);
      staleFrame(0);

      expect(transitions).toEqual([]);
      expect(policy.getHydratedIds()).toEqual([]);
    });
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
