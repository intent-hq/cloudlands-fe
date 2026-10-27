/**
 * Preview fixtures: daemon-shaped trace records for named scenarios. They go
 * through the real `buildTrace`, so the preview exercises the builder too.
 */
import type {
  TraceAgentInfo,
  TraceMessageOrigin,
  TraceRecord,
  TraceUsageTotals,
} from './trace-types';
import { catalogNow } from '$lib/component-catalog/catalog-clock';

const T0 = Date.parse('2026-10-23T14:00:00.000Z');
const S = 1_000;

export interface TraceFixture {
  records: TraceRecord[];
  agents: TraceAgentInfo[];
  now: number;
}

class Builder {
  records: TraceRecord[] = [];
  private seq = 0;
  private calls: Record<string, number> = {};
  private usage: Record<string, TraceUsageTotals> = {};

  constructor(private readonly base: number) {}

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  user(agentId: string, at: number, text: string, origin: TraceMessageOrigin = 'agent') {
    this.records.push({
      id: this.id('msg'),
      ts: this.base + at * S,
      kind: 'message',
      agentId,
      role: 'user',
      messageId: this.id('user-msg'),
      origin,
      text,
    });
  }

  reply(agentId: string, at: number, text: string) {
    const messageId = this.id('assistant-msg');
    this.records.push({
      id: this.id('msg'),
      ts: this.base + at * S,
      kind: 'message',
      agentId,
      role: 'assistant',
      messageId,
      origin: 'system',
      text,
    });
    return messageId;
  }

  tool(
    agentId: string,
    from: number,
    to: number | null,
    toolName: string,
    input: Record<string, unknown>,
    options: { title?: string; kind?: string; error?: string; output?: string } = {},
  ) {
    // Like provider tool call ids, unique only within one agent's session.
    this.calls[agentId] = (this.calls[agentId] ?? 0) + 1;
    const toolCallId = `call-${this.calls[agentId]}`;
    const base = {
      kind: 'tool' as const,
      agentId,
      toolCallId,
      toolName,
      title: options.title ?? toolName,
      toolKind: options.kind ?? 'other',
      input,
    };
    this.records.push({ ...base, id: this.id('evt'), ts: this.base + from * S, status: 'started' });
    if (to !== null) {
      this.records.push({
        ...base,
        id: this.id('evt'),
        ts: this.base + to * S,
        status: options.error ? 'error' : 'completed',
        output: options.error ?? options.output,
      });
    }
    return toolCallId;
  }

  fail(agentId: string, at: number, error: string) {
    this.records.push({
      id: this.id('fail'),
      ts: this.base + at * S,
      kind: 'failure',
      agentId,
      error,
    });
  }

  /** Add usage to an agent and publish a snapshot. */
  spend(at: number, agentId: string, tokensIn: number, tokensOut: number, costUsd?: number) {
    const prev = this.usage[agentId] ?? { tokensIn: 0, tokensOut: 0 };
    const prevCost = prev.cost?.amount ?? 0;
    this.usage[agentId] = {
      tokensIn: prev.tokensIn + tokensIn,
      tokensOut: prev.tokensOut + tokensOut,
      ...(costUsd !== undefined || prev.cost
        ? { cost: { amount: prevCost + (costUsd ?? 0), currency: 'USD' } }
        : {}),
    };
    this.records.push({
      id: this.id('usage'),
      ts: this.base + at * S + 20,
      kind: 'usage',
      byAgent: structuredClone(this.usage),
    });
  }
}

const AGENTS: TraceAgentInfo[] = [
  { id: 'agent-lead', name: 'Lead', model: 'Opus 5.5', provider: 'claude-code', active: false },
  {
    id: 'agent-research',
    name: 'Researcher',
    parentId: 'agent-lead',
    model: 'Sonnet 5.5',
    provider: 'claude-code',
    active: false,
  },
  {
    id: 'agent-writer',
    name: 'Writer',
    parentId: 'agent-lead',
    model: 'Sonnet 5.5',
    provider: 'claude-code',
    active: false,
  },
  {
    id: 'agent-coder',
    name: 'Coder',
    parentId: 'agent-lead',
    model: 'GPT-6 Sol',
    provider: 'codex',
    active: false,
  },
];

function pricingRun(builder: Builder, finished: boolean) {
  const b = builder;
  b.spend(-30, 'agent-lead', 0, 0, 0);
  b.user('agent-lead', 0, 'Launch the new pricing page by Friday', 'human');
  b.tool('agent-lead', 0.6, 1.4, 'Read', { file_path: 'docs/pricing/brief.md' }, { kind: 'read' });
  b.tool(
    'agent-lead',
    1.6,
    6.9,
    'workspace_api',
    { summary: 'Plan the launch', code: 'await ws.note.add("spec", …)' },
    { output: 'Spec updated with the launch plan and three tasks.' },
  );
  b.tool('agent-lead', 7.0, 7.3, 'workspace_api', { summary: 'Delegate research, copy and code' });
  b.reply(
    'agent-lead',
    7.6,
    'Researcher, Writer and Coder are on it. I will review when they finish.',
  );
  b.spend(7.6, 'agent-lead', 18_400, 2_100, 0.12);

  b.user('agent-research', 7.8, 'Research how Linear, Notion and Figma price their team plans');
  b.tool(
    'agent-research',
    8.4,
    13.8,
    'web_search',
    { query: 'Linear pricing 2026' },
    { kind: 'fetch' },
  );
  b.tool(
    'agent-research',
    8.6,
    15.8,
    'web_search',
    { query: 'Notion pricing team plan' },
    { kind: 'fetch' },
  );
  b.tool(
    'agent-research',
    9.0,
    12.5,
    'mcp__postgres__query',
    { query: 'select plan, count(*) from subscriptions group by plan' },
    { kind: 'search', output: 'free 1,204 · pro 391 · team 88' },
  );
  b.tool(
    'agent-research',
    16.2,
    29.2,
    'mcp__browser__navigate',
    { url: 'https://www.g2.com/products/figma/reviews' },
    { kind: 'fetch' },
  );
  b.tool(
    'agent-research',
    29.6,
    33.0,
    'Write',
    { file_path: 'notes/research.md' },
    { kind: 'edit' },
  );
  b.reply(
    'agent-research',
    37.6,
    'Competitors charge per seat; annual plans save 20%. Notes in research.md.',
  );
  b.spend(37.6, 'agent-research', 41_000, 3_800, 0.05);

  b.user('agent-writer', 8.2, 'Write the copy for the three plans');
  b.tool(
    'agent-writer',
    9.0,
    12.6,
    'mcp__notion__fetch',
    { url: 'notion.so/brand-voice' },
    { kind: 'read' },
  );
  b.tool(
    'agent-writer',
    9.4,
    14.5,
    'mcp__figma__get_frames',
    { file: 'Pricing v3' },
    { kind: 'read' },
  );
  b.tool('agent-writer', 15.0, 38.0, 'Write', { file_path: 'copy/plans.md' }, { kind: 'edit' });
  b.tool(
    'agent-writer',
    38.4,
    40.0,
    'mcp__notion__update_page',
    { title: 'Plan copy' },
    { kind: 'edit' },
  );
  b.reply('agent-writer', 45.0, 'Copy for Free, Pro and Team is saved in Notion.');
  b.spend(45.0, 'agent-writer', 9_800, 4_100, 0.09);

  b.user('agent-coder', 8.4, 'Build the pricing page and wire up Stripe prices');
  b.tool(
    'agent-coder',
    9.0,
    11.1,
    'bash',
    { command: 'git switch -c pricing-page' },
    { kind: 'execute' },
  );
  b.tool(
    'agent-coder',
    11.5,
    31.5,
    'Edit',
    { file_path: 'src/routes/pricing/+page.svelte' },
    { kind: 'edit' },
  );
  b.tool(
    'agent-coder',
    32.0,
    35.0,
    'mcp__stripe__create_price',
    { product: 'team', amount: 1200 },
    { kind: 'other' },
  );
  b.tool(
    'agent-coder',
    36.0,
    44.4,
    'bash',
    { command: 'pnpm test checkout' },
    {
      kind: 'execute',
      error: '2 of 14 checkout tests fail — coupon codes are not applied to seat prices.',
    },
  );
  if (finished) {
    b.tool(
      'agent-coder',
      45.0,
      52.1,
      'Edit',
      { file_path: 'src/lib/checkout/coupons.ts' },
      { kind: 'edit' },
    );
    b.tool(
      'agent-coder',
      52.5,
      58.0,
      'bash',
      { command: 'pnpm test checkout' },
      { kind: 'execute' },
    );
    b.reply('agent-coder', 59.0, 'Pricing page is live on the branch; checkout tests pass.');
    b.spend(59.0, 'agent-coder', 52_000, 6_400, 0.23);

    b.user('agent-lead', 60.0, 'Coder, Writer and Researcher finished.', 'system');
    b.tool(
      'agent-lead',
      61.0,
      66.0,
      'bash',
      { command: 'gh pr create --fill' },
      { kind: 'execute' },
    );
    b.tool(
      'agent-lead',
      66.5,
      71.0,
      'mcp__slack__post_message',
      { channel: '#launch' },
      { kind: 'other' },
    );
    b.reply('agent-lead', 72.0, 'Pricing page PR is open and the team is notified in #launch.');
    b.spend(72.0, 'agent-lead', 6_200, 900, 0.04);
  } else {
    b.tool(
      'agent-coder',
      45.0,
      null,
      'Edit',
      { file_path: 'src/lib/checkout/coupons.ts' },
      { kind: 'edit' },
    );
  }
}

function withActive(agents: TraceAgentInfo[], ids: string[]): TraceAgentInfo[] {
  return agents.map((agent) => ({ ...agent, active: ids.includes(agent.id) }));
}

export function liveFixture(): TraceFixture {
  const b = new Builder(T0);
  pricingRun(b, false);
  const now = T0 + 53.4 * S;
  return {
    records: b.records,
    agents: withActive(AGENTS, ['agent-coder']),
    now,
  };
}

/** The live run, re-based so it is happening now (for a running clock). */
export function liveNowFixture(): TraceFixture {
  const now = catalogNow();
  const b = new Builder(now - 53.4 * S);
  pricingRun(b, false);
  return {
    records: b.records,
    agents: withActive(AGENTS, ['agent-coder']),
    now,
  };
}

export function doneFixture(): TraceFixture {
  const b = new Builder(T0);
  // Yesterday, one turn a day and two hours before today's work.
  const yesterday = -26 * 60 * 60;
  b.user('agent-lead', yesterday, 'Draft the pricing brief', 'human');
  b.tool(
    'agent-lead',
    yesterday + 1,
    yesterday + 4,
    'Write',
    { file_path: 'docs/pricing/brief.md' },
    { kind: 'edit' },
  );
  b.reply('agent-lead', yesterday + 9, 'Brief drafted.');
  pricingRun(b, true);
  return {
    records: b.records,
    agents: AGENTS,
    now: T0 + 90 * S,
  };
}

/** One Codex agent with many instant tool calls and no reported cost. */
export function manyToolsFixture(): TraceFixture {
  const b = new Builder(T0);
  const agents: TraceAgentInfo[] = [
    {
      id: 'agent-solo',
      name: 'Sidebar design',
      model: 'GPT-6 Sol',
      provider: 'codex',
      active: true,
    },
  ];
  b.spend(-10, 'agent-solo', 0, 0);
  b.user('agent-solo', 0, 'Iterate on the sidebar tabs until they match the mock', 'human');
  let t = 1;
  const commands = [
    'git diff --stat',
    'pnpm exec prettier --check src/',
    'rg -n "SidebarTabs" src',
    'pnpm vitest run sidebar',
  ];
  for (let i = 0; i < 140; i += 1) {
    if (i % 3 === 0) {
      b.tool(
        'agent-solo',
        t,
        t,
        'bash',
        { command: commands[i % commands.length] },
        { kind: 'execute' },
      );
    } else if (i % 3 === 1) {
      b.tool(
        'agent-solo',
        t,
        t + 0.01,
        'Read file',
        { path: `src/lib/components/sidebar/Part${i}.svelte` },
        { kind: 'read' },
      );
    } else {
      b.tool(
        'agent-solo',
        t,
        t,
        'Editing files',
        { path: `src/lib/components/sidebar/Part${i}.svelte` },
        {
          kind: 'edit',
          ...(i === 59 ? { error: 'Patch did not apply: context mismatch at line 42.' } : {}),
        },
      );
    }
    t += 2 + (i % 5);
    if (i === 46 || i === 93) {
      b.reply('agent-solo', t, 'Checkpoint: tabs render; next, the collapsed rail.');
      b.spend(t, 'agent-solo', 410_000 + i * 900, 12_000 + i * 20);
      t += 1.5;
      b.user('agent-solo', t, 'Script sidebar visual review finished', 'system');
      t += 1;
    }
  }
  const now = T0 + (t + 4) * S;
  return { records: b.records, agents, now };
}

/** A coordinator that delegated to many agents. */
export function manyAgentsFixture(): TraceFixture {
  const b = new Builder(T0);
  const agents: TraceAgentInfo[] = [
    {
      id: 'agent-coord',
      name: 'Coordinator',
      model: 'Fable 5.1',
      provider: 'auggie',
      active: false,
    },
  ];
  b.spend(-10, 'agent-coord', 0, 0, 0);
  b.user('agent-coord', 0, 'Write a guide for every service in the repository', 'human');
  b.tool('agent-coord', 1, 6, 'workspace_api', { summary: 'Create 48 guide tasks' });
  b.reply('agent-coord', 8, 'Delegated 48 guides.');
  b.spend(8, 'agent-coord', 22_000, 3_000, 0.31);
  const areas = [
    'Billing',
    'Search',
    'Collector',
    'Simulator',
    'Gateway',
    'Ledger',
    'Auth',
    'Lake',
  ];
  for (let i = 0; i < 48; i += 1) {
    const id = `agent-guide-${i}`;
    agents.push({
      id,
      name: `${areas[i % areas.length]} guide ${Math.floor(i / areas.length) + 1}`,
      parentId: 'agent-coord',
      model: 'GPT-5.6 Sol',
      provider: 'auggie',
      active: false,
    });
    const start = 9 + (i % 12) * 2.5 + Math.floor(i / 12) * 4;
    b.user(id, start, `Write the ${areas[i % areas.length]} guide`);
    b.tool(
      id,
      start + 1,
      start + 6 + (i % 7),
      'Read',
      { file_path: `services/${i}/README.md` },
      { kind: 'read' },
    );
    b.tool(
      id,
      start + 8,
      start + 20 + (i % 11) * 3,
      'Write',
      { file_path: `guides/${i}.md` },
      { kind: 'edit' },
    );
    const end = start + 26 + (i % 11) * 3 + (i % 4) * 5;
    b.reply(id, end, 'Guide written.');
    b.spend(end, id, 12_000 + i * 300, 2_400 + i * 40, 0.02 + (i % 5) * 0.01);
  }
  const now = T0 + 200 * S;
  return { records: b.records, agents, now };
}

/** Long names, a long prompt, and a deep chain of agents. */
export function longNamesFixture(): TraceFixture {
  const b = new Builder(T0);
  const agents: TraceAgentInfo[] = [
    {
      id: 'agent-a',
      name: 'Investigate flaky checkout tests across every payment provider integration',
      model: 'Claude Opus 5.5 (High reasoning effort)',
      provider: 'claude-code',
      active: true,
    },
    {
      id: 'agent-b',
      name: 'Reproduce the Stripe coupon failure locally with recorded fixtures',
      parentId: 'agent-a',
      model: 'Sonnet 5.5',
      provider: 'claude-code',
      active: true,
    },
    {
      id: 'agent-c',
      name: 'Bisect the coupon regression',
      parentId: 'agent-b',
      model: 'Haiku 4.5',
      provider: 'claude-code',
      active: true,
    },
  ];
  b.spend(-5, 'agent-a', 0, 0, 0);
  b.user(
    'agent-a',
    0,
    'Checkout tests have been flaky for a week. Find out why coupons sometimes are not applied to seat prices, fix it, add regression tests for every provider, and write up what happened so support can answer customers.',
    'human',
  );
  b.tool('agent-a', 1, 3, 'workspace_api', {
    summary: 'Delegate the reproduction to a sub-agent with recorded Stripe fixtures',
  });
  b.user('agent-b', 3.5, 'Reproduce the Stripe coupon failure locally with recorded fixtures');
  b.tool(
    'agent-b',
    4,
    18,
    'bash',
    { command: 'STRIPE_FIXTURES=recorded pnpm vitest run checkout --reporter=verbose --retry=0' },
    { kind: 'execute' },
  );
  b.user('agent-c', 19, 'Bisect the coupon regression');
  b.tool(
    'agent-c',
    20,
    null,
    'bash',
    { command: 'git bisect run pnpm vitest run checkout/coupons.test.ts' },
    { kind: 'execute' },
  );
  const now = T0 + 41 * S;
  return { records: b.records, agents, now };
}

/** A run from two days ago: turns survive, tool calls have expired. */
export function expiredToolsFixture(): TraceFixture {
  const base = T0 - 2 * 24 * 60 * 60 * S;
  const b = new Builder(base);
  b.user('agent-lead', 0, 'Refresh the onboarding checklist copy', 'human');
  b.reply('agent-lead', 6, 'Delegated the copy refresh.');
  b.user('agent-writer', 7, 'Refresh the onboarding checklist copy');
  b.reply('agent-writer', 64, 'Copy refreshed in onboarding.md.');
  b.user('agent-lead', 65, 'Writer finished.', 'system');
  b.reply('agent-lead', 80, 'Reviewed and merged.');
  const now = T0;
  return { records: b.records, agents: AGENTS, now };
}

/**
 * One day with three bursts: a morning prompt, a wake-up two hours later, and
 * a follow-up 45 minutes after that. Built from local noon, so every burst
 * falls on the same local day in any time zone.
 */
export function dayFixture(): TraceFixture {
  const noon = new Date(T0);
  noon.setHours(12, 0, 0, 0);
  const b = new Builder(noon.getTime() - 3 * 60 * 60 * S);
  b.spend(-60, 'agent-lead', 0, 0, 0);
  b.user('agent-lead', 0, 'Sketch the pricing page layout', 'human');
  b.tool('agent-lead', 2, 3.1, 'Read', { file_path: 'docs/pricing/brief.md' }, { kind: 'read' });
  b.tool(
    'agent-lead',
    5,
    48,
    'Edit',
    { file_path: 'src/routes/pricing/+page.svelte' },
    {
      kind: 'edit',
    },
  );
  b.tool(
    'agent-lead',
    52,
    118,
    'Bash',
    { command: 'pnpm sandbox:shot pricing' },
    {
      kind: 'execute',
      title: 'Screenshot the pricing page',
    },
  );
  b.spend(160, 'agent-lead', 120_000, 6_000, 0.42);
  b.reply('agent-lead', 164, 'Layout sketched; screenshot attached.');

  const wake = 2 * 60 * 60 + 300;
  b.user('agent-lead', wake, 'Script visual review finished', 'system');
  b.tool('agent-lead', wake + 2, wake + 9, 'Read', { file_path: 'review.json' }, { kind: 'read' });
  b.tool(
    'agent-lead',
    wake + 12,
    wake + 31,
    'Edit',
    { file_path: 'pricing.css' },
    {
      kind: 'edit',
    },
  );
  b.spend(wake + 38, 'agent-lead', 40_000, 2_000, 0.11);
  b.reply('agent-lead', wake + 40, 'Fixed the two review findings.');

  const follow = wake + 45 * 60;
  b.user('agent-lead', follow, 'Tighten the spacing on mobile', 'human');
  b.tool(
    'agent-lead',
    follow + 3,
    follow + 40,
    'Edit',
    { file_path: 'pricing.css' },
    {
      kind: 'edit',
    },
  );
  b.tool(
    'agent-lead',
    follow + 44,
    follow + 102,
    'Bash',
    { command: 'pnpm test:pricing' },
    {
      kind: 'execute',
      title: 'Run the pricing tests',
    },
  );
  b.spend(follow + 108, 'agent-lead', 60_000, 3_000, 0.19);
  b.reply('agent-lead', follow + 110, 'Mobile spacing tightened; tests pass.');
  const now = b.records[b.records.length - 1].ts + 30 * S;
  return { records: b.records, agents: AGENTS, now };
}

/** One agent, one short turn, no tools. */
export function minimalFixture(): TraceFixture {
  const b = new Builder(T0);
  b.user('agent-lead', 0, 'What changed in the last release?', 'human');
  b.reply('agent-lead', 4.2, 'Three fixes and the new pricing page.');
  const now = T0 + 30 * S;
  return { records: b.records, agents: AGENTS, now };
}
