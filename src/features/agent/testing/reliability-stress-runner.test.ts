import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainStoreState } from '../../../store/main/types';
import {
  agentSubscriptionsReducer,
  appendDelegationGroupEvent,
  clearAgentQueue,
  enqueueEvent,
  initialState,
  MAX_DELEGATION_GROUP_EVENTS,
  markDelegationAgentCompleted,
  markDelegationDelivered,
  recordDeliveryFailure,
  recordDeliverySuccess,
  recordDeliveryTimeout,
  setAgentStatus,
  subscribeToDelegationGroup,
  type AgentSubscriptionsState,
  type AgentSubscriptionRecord,
  type QueuedEventRecord,
} from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice';
import {
  selectAgentQueueLength,
  selectAgentStatus,
  selectDelegationGroup,
  selectIsDelegationGroupComplete,
  selectWorkspaceSubscriptionState,
} from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors';
import type { WorkspaceEvent } from '../../events/types';
import {
  ProgrammaticTestAgentProvider,
  PROGRAMMATIC_TEST_PROVIDER_ID,
  type ProgrammaticTestStep,
} from './programmatic-test-agent-provider';

const DEFAULT_SEED = Number(process.env.AGENT_RELIABILITY_STRESS_SEED ?? 0x5eedc0de);
const SOAK_ITERATIONS = Math.max(1, Number(process.env.AGENT_RELIABILITY_STRESS_ITERATIONS ?? 1));

type ScenarioName =
  | 'delegate-wave'
  | 'overlapping-completion'
  | 'busy-idle-parent'
  | 'interruption'
  | 'provider-hang'
  | 'rapid-task-wakeup'
  | 'subscription-churn';

type StressResult = {
  seed: number;
  iteration: number;
  scenario: ScenarioName;
  agents: number;
  events: number;
  diagnostics: string[];
};

type AgentRun = {
  id: string;
  provider: ProgrammaticTestAgentProvider;
  stream: Promise<void>;
  completed: boolean;
  interrupted: boolean;
  failed: boolean;
};

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

class ReliabilityStressRunner {
  private state: AgentSubscriptionsState = initialState;
  private readonly wsId: string;
  private readonly random: () => number;
  private eventCount = 0;

  constructor(
    private readonly seed: number,
    private readonly iteration: number,
  ) {
    this.random = createSeededRandom(seed + iteration * 9973);
    this.wsId = `stress-ws-${seed}-${iteration}`;
  }

  async run(scenario: ScenarioName): Promise<StressResult> {
    try {
      switch (scenario) {
        case 'delegate-wave':
          return await this.runDelegateWave();
        case 'overlapping-completion':
          return await this.runOverlappingCompletion();
        case 'busy-idle-parent':
          return await this.runBusyIdleParent();
        case 'interruption':
          return await this.runInterruption();
        case 'provider-hang':
          return await this.runProviderHang();
        case 'rapid-task-wakeup':
          return await this.runRapidTaskWakeup();
        case 'subscription-churn':
          return await this.runSubscriptionChurn();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Reliability stress failure seed=${this.seed} iteration=${this.iteration} scenario=${scenario}: ${message}`,
      );
    }
  }

  private async runDelegateWave(): Promise<StressResult> {
    const parentId = this.agentId('parent');
    const groupId = this.groupId('wave');
    const children = this.childIds('wave', 3 + this.nextInt(3));
    this.dispatch(setAgentStatus(this.wsId, parentId, 'waiting'));
    for (const childId of children) this.subscribe(parentId, groupId, childId, 'all');

    const runs = children.map((childId, index) =>
      this.startRun(childId, [
        { type: 'chunk', text: `child-${index}` },
        { type: 'complete', delayMs: 1 + this.nextInt(3) },
      ]),
    );

    await this.settleRuns(runs);
    for (const run of runs) this.completeChild(groupId, run.id);
    this.dispatch(setAgentStatus(this.wsId, parentId, 'idle'));

    this.expectComplete(groupId, true);
    expect(selectAgentStatus.select(this.rootState(), this.wsId, parentId)).toBe('idle');
    return this.result('delegate-wave', children.length);
  }

  private async runOverlappingCompletion(): Promise<StressResult> {
    const parentId = this.agentId('parent-overlap');
    const groupId = this.groupId('overlap');
    const children = this.childIds('overlap', 5);
    for (const childId of children) this.subscribe(parentId, groupId, childId, 'all');

    const runs = children.map((childId) =>
      this.startRun(childId, [{ type: 'chunk', text: childId }, { type: 'awaitCompletion' }]),
    );
    await Promise.resolve();
    await Promise.all(runs.map((run) => run.provider.completeActiveRun(`done:${run.id}`)));
    await this.settleRuns(runs);
    for (const run of runs) this.completeChild(groupId, run.id);

    this.expectComplete(groupId, true);
    const tracker = selectDelegationGroup.select(this.rootState(), this.wsId, groupId)!;
    expect(new Set(tracker.completedAgentIds).size).toBe(children.length);
    return this.result('overlapping-completion', children.length);
  }

  private async runBusyIdleParent(): Promise<StressResult> {
    const parentId = this.agentId('busy-parent');
    const groupId = this.groupId('busy');
    const children = this.childIds('busy', 2 + this.nextInt(2));
    this.dispatch(setAgentStatus(this.wsId, parentId, 'responding'));
    for (const childId of children) this.subscribe(parentId, groupId, childId, 'all');

    const runs = children.map((childId) => this.startRun(childId, [{ type: 'complete' }]));
    await this.settleRuns(runs);
    for (const run of runs) this.completeChild(groupId, run.id);
    this.expectComplete(groupId, true);
    expect(selectAgentStatus.select(this.rootState(), this.wsId, parentId)).toBe('responding');

    this.dispatch(enqueueEvent(this.wsId, parentId, this.queueEvent('parent-busy', groupId)));
    expect(selectAgentQueueLength.select(this.rootState(), this.wsId, parentId)).toBe(1);
    this.dispatch(setAgentStatus(this.wsId, parentId, 'idle'));
    this.dispatch(clearAgentQueue(this.wsId, parentId));
    expect(selectAgentQueueLength.select(this.rootState(), this.wsId, parentId)).toBe(0);
    return this.result('busy-idle-parent', children.length);
  }

  private async runInterruption(): Promise<StressResult> {
    const parentId = this.agentId('interrupt-parent');
    const groupId = this.groupId('interrupt');
    const children = this.childIds('interrupt', 3);
    for (const childId of children) this.subscribe(parentId, groupId, childId, 'all');

    const runs = children.map((childId) =>
      this.startRun(childId, [{ type: 'chunk', text: 'working' }, { type: 'hang' }]),
    );
    await Promise.resolve();
    await Promise.all(runs.map((run) => run.provider.stop()));
    await this.settleRuns(runs);
    for (const run of runs) this.completeChild(groupId, run.id);

    expect(runs.every((run) => run.interrupted)).toBe(true);
    this.expectComplete(groupId, true);
    return this.result('interruption', children.length);
  }

  private async runProviderHang(): Promise<StressResult> {
    const parentId = this.agentId('hang-parent');
    const groupId = this.groupId('hang');
    const hungId = this.agentId('hung-child');
    const doneId = this.agentId('done-child');
    this.subscribe(parentId, groupId, hungId, 'all');
    this.subscribe(parentId, groupId, doneId, 'all');

    const hung = this.startRun(hungId, [{ type: 'chunk', text: 'partial' }, { type: 'hang' }]);
    const done = this.startRun(doneId, [{ type: 'complete' }]);
    await this.settleRuns([done]);
    this.completeChild(groupId, done.id);
    this.expectComplete(groupId, false);

    this.dispatch(recordDeliveryTimeout(this.wsId, this.deliveryObservedAt()));
    await hung.provider.failActiveRun('planned hang timeout');
    await expect(hung.stream).rejects.toThrow('planned hang timeout');
    hung.failed = true;
    this.completeChild(groupId, hung.id);
    this.expectComplete(groupId, true);
    return this.result('provider-hang', 2);
  }

  private async runRapidTaskWakeup(): Promise<StressResult> {
    const parentId = this.agentId('rapid-parent');
    const taskAgents = this.childIds('rapid-task', 4 + this.nextInt(3));
    this.dispatch(setAgentStatus(this.wsId, parentId, 'idle'));
    for (const agentId of taskAgents) {
      this.dispatch(setAgentStatus(this.wsId, agentId, 'responding'));
      for (let i = 0; i < 3; i++) {
        this.dispatch(enqueueEvent(this.wsId, agentId, this.queueEvent(`wake-${i}`, agentId)));
      }
    }

    for (const agentId of taskAgents) {
      expect(selectAgentQueueLength.select(this.rootState(), this.wsId, agentId)).toBe(3);
      this.dispatch(setAgentStatus(this.wsId, agentId, 'idle'));
      this.dispatch(clearAgentQueue(this.wsId, agentId));
      this.dispatch(recordDeliverySuccess(this.wsId, this.deliveryObservedAt()));
    }

    const ws = selectWorkspaceSubscriptionState.select(this.rootState(), this.wsId);
    expect(Object.values(ws.agentQueues).every((queue) => queue.length === 0)).toBe(true);
    expect(ws.deliveryStats.successfulDeliveries).toBe(taskAgents.length);
    return this.result('rapid-task-wakeup', taskAgents.length);
  }

  private async runSubscriptionChurn(): Promise<StressResult> {
    const parentId = this.agentId('churn-parent');
    const groupId = this.groupId('churn');
    const children = this.childIds('churn-child', 4 + this.nextInt(3));

    for (const childId of children) {
      this.subscribe(parentId, groupId, childId, 'all');
      this.subscribe(parentId, groupId, childId, 'all');
    }

    let ws = selectWorkspaceSubscriptionState.select(this.rootState(), this.wsId);
    const groupSubscriptions = Object.values(ws.subscriptions).filter(
      (sub) => sub.agentId === parentId && sub.filter.delegationGroup?.groupId === groupId,
    );
    expect(groupSubscriptions).toHaveLength(1);
    const [subscription] = groupSubscriptions;
    expect(new Set(subscription.filter.actorIds).size).toBe(children.length);

    let tracker = selectDelegationGroup.select(this.rootState(), this.wsId, groupId)!;
    expect(new Set(tracker.expectedAgentIds).size).toBe(children.length);
    expect(tracker.expectedAgentIds).toHaveLength(children.length);

    for (let i = 0; i < MAX_DELEGATION_GROUP_EVENTS + 7; i++) {
      this.dispatch(
        appendDelegationGroupEvent(this.wsId, groupId, this.workspaceEvent('agent:completed', children[i % children.length], `churn-${i}`)),
      );
    }
    tracker = selectDelegationGroup.select(this.rootState(), this.wsId, groupId)!;
    expect(tracker.events).toHaveLength(MAX_DELEGATION_GROUP_EVENTS);
    expect(tracker.events[0].data).toEqual({ label: 'churn-7' });

    for (const childId of children) {
      this.completeChild(groupId, childId);
      this.completeChild(groupId, childId);
    }
    tracker = selectDelegationGroup.select(this.rootState(), this.wsId, groupId)!;
    expect(new Set(tracker.completedAgentIds).size).toBe(children.length);
    expect(tracker.completedAgentIds).toHaveLength(children.length);
    expect(tracker.delivered).toBe(true);

    ws = selectWorkspaceSubscriptionState.select(this.rootState(), this.wsId);
    expect(Object.keys(ws.subscriptions)).toHaveLength(1);
    return this.result('subscription-churn', children.length);
  }

  private startRun(agentId: string, steps: ProgrammaticTestStep[]): AgentRun {
    const provider = new ProgrammaticTestAgentProvider({
      provider: PROGRAMMATIC_TEST_PROVIDER_ID,
      programmaticScript: { steps },
    });
    const run: AgentRun = {
      id: agentId,
      provider,
      stream: Promise.resolve(),
      completed: false,
      interrupted: false,
      failed: false,
    };
    this.dispatch(setAgentStatus(this.wsId, agentId, 'responding'));
    run.stream = provider.streamMessage([], {
      onChunk: () =>
        this.dispatch(enqueueEvent(this.wsId, agentId, this.queueEvent('chunk', agentId))),
      onComplete: (message) => {
        run.completed = true;
        run.interrupted = Boolean(message.metadata?.interrupted);
        this.dispatch(clearAgentQueue(this.wsId, agentId));
        this.dispatch(setAgentStatus(this.wsId, agentId, 'completed'));
        this.dispatch(recordDeliverySuccess(this.wsId, this.deliveryObservedAt()));
      },
      onError: () => {
        run.failed = true;
        this.dispatch(setAgentStatus(this.wsId, agentId, 'failed'));
        this.dispatch(recordDeliveryFailure(this.wsId, this.deliveryObservedAt()));
      },
    });
    return run;
  }

  private async settleRuns(runs: AgentRun[]): Promise<void> {
    await Promise.all(runs.map((run) => run.stream));
    for (const run of runs) await run.provider.cleanup();
  }

  private subscribe(
    parentAgentId: string,
    groupId: string,
    childAgentId: string,
    awaitMode: 'all' | 'any',
  ): void {
    const seed: AgentSubscriptionRecord = {
      id: `${groupId}-sub-${childAgentId}`,
      agentId: parentAgentId,
      agentName: parentAgentId,
      workspaceId: this.wsId,
      filter: {
        eventTypes: ['agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: [childAgentId],
        priority: 'high',
        delegationGroup: { groupId, awaitMode, expectedAgentIds: [childAgentId] },
      },
      createdAt: '2026-06-19T00:00:00.000Z',
    };
    this.dispatch(subscribeToDelegationGroup(this.wsId, seed));
  }

  private completeChild(groupId: string, agentId: string): void {
    const event = this.workspaceEvent('agent:completed', agentId);
    this.dispatch(appendDelegationGroupEvent(this.wsId, groupId, event));
    this.dispatch(markDelegationAgentCompleted(this.wsId, groupId, agentId));
    if (selectIsDelegationGroupComplete.select(this.rootState(), this.wsId, groupId)) {
      this.dispatch(markDelegationDelivered(this.wsId, groupId));
    }
  }

  private expectComplete(groupId: string, expected: boolean): void {
    expect(selectIsDelegationGroupComplete.select(this.rootState(), this.wsId, groupId)).toBe(
      expected,
    );
  }

  private dispatch(
    action: ReturnType<typeof agentSubscriptionsReducer> extends never ? never : any,
  ): void {
    this.state = agentSubscriptionsReducer(this.state, action);
  }

  private rootState(): MainStoreState {
    return { agentSubscriptions: this.state } as unknown as MainStoreState;
  }

  private deliveryObservedAt(): string {
    return `2026-06-19T00:00:${String(this.eventCount++).padStart(2, '0')}.000Z`;
  }

  private result(scenario: ScenarioName, agents: number): StressResult {
    const ws = selectWorkspaceSubscriptionState.select(this.rootState(), this.wsId);
    return {
      seed: this.seed,
      iteration: this.iteration,
      scenario,
      agents,
      events: this.eventCount,
      diagnostics: [
        `subscriptions=${Object.keys(ws.subscriptions).length}`,
        `groups=${Object.keys(ws.delegationGroups).length}`,
        `deliveries=${ws.deliveryStats.totalDeliveries}`,
      ],
    };
  }

  private queueEvent(label: string, actorId: string): QueuedEventRecord {
    return {
      event: this.workspaceEvent('agent:wakeup', actorId, label),
      queuedAt: '2026-06-19T00:00:00.000Z',
      priority: this.random() > 0.75 ? 'high' : 'normal',
    };
  }

  private workspaceEvent(type: string, actorId: string, label = type): WorkspaceEvent {
    this.eventCount += 1;
    return {
      id: `${this.wsId}-${this.eventCount}-${label}`,
      type,
      actor: { type: 'agent', id: actorId },
      timestamp: '2026-06-19T00:00:00.000Z',
      data: { label },
    } as WorkspaceEvent;
  }

  private childIds(prefix: string, count: number): string[] {
    return Array.from({ length: count }, (_, index) => this.agentId(`${prefix}-${index}`));
  }

  private agentId(label: string): string {
    return `agent-${this.seed}-${this.iteration}-${label}`;
  }

  private groupId(label: string): string {
    return `group-${this.seed}-${this.iteration}-${label}`;
  }

  private nextInt(maxExclusive: number): number {
    return Math.floor(this.random() * maxExclusive);
  }
}

async function runStressSuite(seed = DEFAULT_SEED, iterations = 1): Promise<StressResult[]> {
  const scenarios: ScenarioName[] = [
    'delegate-wave',
    'overlapping-completion',
    'busy-idle-parent',
    'interruption',
    'provider-hang',
    'rapid-task-wakeup',
    'subscription-churn',
  ];
  const results: StressResult[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const scenario of scenarios) {
      results.push(await new ReliabilityStressRunner(seed, iteration).run(scenario));
    }
  }
  return results;
}

describe('agent reliability stress runner', () => {
  const originalTesting = process.env.TESTING;

  beforeEach(() => {
    process.env.TESTING = 'true';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTesting === undefined) delete process.env.TESTING;
    else process.env.TESTING = originalTesting;
  });

  it('runs bounded deterministic multi-agent chaos scenarios with seed diagnostics', async () => {
    const results = await runStressSuite(DEFAULT_SEED, SOAK_ITERATIONS);

    expect(results).toHaveLength(7 * SOAK_ITERATIONS);
    expect(results.map((result) => result.scenario)).toContain('provider-hang');
    expect(results.map((result) => result.scenario)).toContain('rapid-task-wakeup');
    expect(results.map((result) => result.scenario)).toContain('subscription-churn');
    expect(results.every((result) => result.seed === DEFAULT_SEED)).toBe(true);
    expect(results.every((result) => result.events > 0)).toBe(true);
  }, 5000);

  it('is deterministic for the same seed and iteration count', async () => {
    const first = await runStressSuite(DEFAULT_SEED, 1);
    const second = await runStressSuite(DEFAULT_SEED, 1);

    expect(second).toEqual(first);
  });

  it('varies deterministic coverage by seed', async () => {
    const first = await runStressSuite(DEFAULT_SEED, 1);
    const second = await runStressSuite(DEFAULT_SEED + 1, 1);

    expect(second).not.toEqual(first);
    expect(second.every((result) => result.seed === DEFAULT_SEED + 1)).toBe(true);
  });
});
