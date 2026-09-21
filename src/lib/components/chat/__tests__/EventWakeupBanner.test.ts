/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('../InlineAgentAvatar.svelte', async () => ({
  default: (await import('./mocks/MockInlineAgentAvatar.svelte')).default,
}));

import EventWakeupBanner from '../EventWakeupBanner.svelte';
import { store as appStore } from '$store/renderer/store';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSession, Workspace } from '$shared/types';
import {
  SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
  SUBSCRIPTION_CARD_SURFACE_CLASS,
  SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  EVENT_WAKEUP_IN_THREAD_SPACING_CLASS,
} from '../subscription-disclosure';

type Metadata = {
  type: 'event_notification';
  eventCount: number;
  eventTypes: string[];
  events?: Array<{
    type: string;
    data: Record<string, unknown>;
    timestamp: string;
  }>;
};

const WORKSPACE = { id: 'ws-event-wakeup' } as Workspace;

beforeAll(() => appStore.init());

function renderBanner(
  metadata: Metadata,
  props: Partial<{
    embedded: boolean;
    compact: boolean;
    suppressTopGap: boolean;
    messageText: string;
    showAgentCards: boolean;
    workspace: Workspace;
  }> = {},
) {
  return render(EventWakeupBanner, {
    props: { metadata, asDivider: true, showAgentCards: false, ...props },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EventWakeupBanner details disclosure', () => {
  it('uses only named standard avatar geometry in the production wake-up stack', () => {
    const avatarSource = readFileSync(
      resolve(process.cwd(), 'src/lib/components/chat/InlineAgentAvatar.svelte'),
      'utf8',
    );
    const bannerSource = readFileSync(
      resolve(process.cwd(), 'src/lib/components/chat/EventWakeupBanner.svelte'),
      'utf8',
    );

    expect(avatarSource).toContain('variant="standard"');
    expect(avatarSource).not.toContain('size={18}');
    expect(avatarSource).not.toContain('rounded-full');
    expect(bannerSource).toContain('<AgentAvatarStack');
    expect(bannerSource).toContain('variant="standard"');
    expect(bannerSource).not.toMatch(/-space-x-|translate-y-|top-\[/);
  });

  it('uses the shared compact subscription card shell, header rhythm, and separator', async () => {
    renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['workspace:updated'],
    });

    const card = screen.getByTestId('event-wakeup-card');
    const summary = screen.getByTestId('event-wakeup-summary');
    for (const token of [
      ...SUBSCRIPTION_CARD_CONTAINMENT_CLASS.split(' '),
      ...SUBSCRIPTION_CARD_SURFACE_CLASS.split(' '),
    ]) {
      expect(card.classList.contains(token)).toBe(true);
    }
    expect(card.classList.contains(EVENT_WAKEUP_IN_THREAD_SPACING_CLASS)).toBe(true);
    expect(card.classList.contains('mb-4')).toBe(false);
    expect(card.getAttribute('data-external-spacing-owner')).toBe('event-wakeup-card');
    for (const token of ['px-1.5', 'py-1']) {
      expect(card.classList.contains(token)).toBe(false);
    }
    const header = screen.getByTestId('event-wakeup-header');
    for (const token of SUBSCRIPTION_DISCLOSURE_ROW_CLASS.split(' ')) {
      expect(header.classList.contains(token)).toBe(true);
    }

    await fireEvent.click(summary);
    const details = screen.getByTestId('event-wakeup-details');
    expect(details.className).toContain('border-t');
    expect(details.className).toContain('border-border');
    expect(details.className).toContain('py-2');
    expect(details.className).not.toContain('border-l');
    expect(details.className).not.toContain('pl-5');
  });

  it('yields its external top gap to the batched-delivery seam when suppressed', () => {
    renderBanner(
      { type: 'event_notification', eventCount: 1, eventTypes: ['workspace:updated'] },
      { suppressTopGap: true },
    );

    const card = screen.getByTestId('event-wakeup-card');
    expect(card.classList.contains(EVENT_WAKEUP_IN_THREAD_SPACING_CLASS)).toBe(false);
    expect(card.classList.contains('mt-0')).toBe(true);
    // The preceding gap owns the seam, so the card no longer claims it.
    expect(card.hasAttribute('data-external-spacing-owner')).toBe(false);
    for (const token of SUBSCRIPTION_CARD_SURFACE_CLASS.split(' ')) {
      expect(card.classList.contains(token)).toBe(true);
    }
  });

  it('stays flat and spacing-neutral when embedded in an existing card', async () => {
    renderBanner(
      { type: 'event_notification', eventCount: 1, eventTypes: ['note:updated'] },
      { embedded: true },
    );

    const card = screen.getByTestId('event-wakeup-card');
    for (const token of SUBSCRIPTION_CARD_CONTAINMENT_CLASS.split(' ')) {
      expect(card.classList.contains(token)).toBe(true);
    }
    for (const token of SUBSCRIPTION_CARD_SURFACE_CLASS.split(' ')) {
      expect(card.classList.contains(token)).toBe(false);
    }
    expect(card.classList.contains(EVENT_WAKEUP_IN_THREAD_SPACING_CLASS)).toBe(false);
    expect(card.classList.contains('mb-4')).toBe(false);
    expect(card.getAttribute('data-embedded')).toBe('true');
    expect(card.hasAttribute('data-external-spacing-owner')).toBe(false);

    await fireEvent.click(screen.getByTestId('event-wakeup-summary'));
    expect(screen.getByTestId('event-wakeup-details').className).toContain('border-t');
  });

  it('renders structured events in daemon order with friendly labels and safe summaries', async () => {
    const longSummary = `Completed ${'a-very-long-unbroken-result'.repeat(20)} 你好世界`;
    renderBanner({
      type: 'event_notification',
      eventCount: 4,
      eventTypes: ['agent:idle', 'note:updated', 'custom:signal', 'custom:signal'],
      events: [
        {
          type: 'agent:idle',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: {
            agentId: 'agent-private-id',
            agentName: 'Builder',
            completionReport: 'Implementation complete',
            report: 'lower priority report',
            unrelatedPayload: 'must stay hidden',
          },
        },
        {
          type: 'note:updated',
          timestamp: '2026-08-12T12:01:00.000Z',
          data: { report: 'Specification refreshed' },
        },
        {
          type: 'custom:signal',
          timestamp: '2026-08-12T12:02:00.000Z',
          data: { lastResponseSummary: longSummary },
        },
        {
          type: 'custom:signal',
          timestamp: '2026-08-12T12:02:00.000Z',
          data: { lastResponseSummary: 'Duplicate trigger remains visible' },
        },
      ],
    });

    const summary = screen.getByTestId('event-wakeup-summary');
    expect(summary.tagName).toBe('BUTTON');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('event-wakeup-details')).toBeNull();

    await fireEvent.click(summary);

    const details = screen.getByTestId('event-wakeup-details');
    const items = within(details).getAllByTestId('event-wakeup-detail');
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Builder finished'),
      expect.stringContaining('note changes'),
      expect.stringContaining('custom:signal'),
      expect.stringContaining('custom:signal'),
    ]);
    expect(items[0].textContent).toContain('Builder');
    expect(items[0].textContent).toContain('Implementation complete');
    expect(items[0].textContent).not.toContain('lower priority report');
    expect(details.textContent).toContain('Specification refreshed');
    expect(details.textContent).toContain(longSummary);
    expect(details.textContent).toContain('Duplicate trigger remains visible');
    expect(details.textContent).not.toContain('agent-private-id');
    expect(details.textContent).not.toContain('must stay hidden');
    expect(within(details).getAllByRole('time')).toHaveLength(4);
  });

  it('contains long untrusted text at narrow widths without truncating the detail', async () => {
    const summaryText = 'unbroken'.repeat(80);
    const { container } = renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['custom:event'],
      events: [
        {
          type: 'custom:event',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: { agentName: 'Agent'.repeat(40), completionReport: summaryText },
        },
      ],
    });
    container.style.width = '240px';
    await fireEvent.click(screen.getByTestId('event-wakeup-summary'));

    const details = screen.getByTestId('event-wakeup-details');
    const report = screen.getByText(summaryText);
    const card = screen.getByTestId('event-wakeup-card');
    const summary = screen.getByTestId('event-wakeup-summary');
    expect(card.className).toContain('max-w-full');
    expect(card.className).toContain('overflow-hidden');
    expect(summary.className).toContain('min-w-0');
    expect(summary.className).toContain('overflow-hidden');
    expect(details.className).toContain('min-w-0');
    expect(report.className).toContain('[overflow-wrap:anywhere]');
    expect(report.className).toContain('whitespace-pre-wrap');
  });

  it('assigns semantic, compact typography roles without a larger type class', async () => {
    const reportText =
      'Preserve this report exactly.\n\nUnicode 你好世界 and token-' + 'unbroken'.repeat(20);
    renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          type: 'agent:idle',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: { agentName: 'Builder', completionReport: reportText },
        },
      ],
    });

    const name = screen.getByTestId('event-wakeup-agent-name');
    const status = screen.getByTestId('event-wakeup-status');
    expect(name.tagName).toBe('STRONG');
    expect(name.className).toContain('type-body');
    expect(name.className).toContain('font-normal');
    expect(name.className).toContain('text-muted-foreground');
    expect(status.tagName).toBe('SPAN');
    expect(status.className).toContain('type-body');
    expect(status.className).toContain('font-normal');
    expect(status.className).toContain('text-muted-foreground');

    await fireEvent.click(screen.getByTestId('event-wakeup-summary'));
    const timestamp = screen.getByTestId('event-wakeup-timestamp');
    const report = screen.getByTestId('event-wakeup-report');
    expect(timestamp.tagName).toBe('TIME');
    expect(timestamp.className).toContain('type-caption');
    expect(timestamp.className).toContain('tabular-nums');
    expect(timestamp.className).toContain('text-subtle');
    expect(report.tagName).toBe('P');
    expect(report.textContent).toBe(reportText);
    expect(report.className).toContain('type-body');
    expect(report.className).toContain('max-w-[68ch]');
    expect(report.className).toContain('[overflow-wrap:anywhere]');

    for (const element of [name, status, timestamp, report]) {
      expect(element.className).not.toMatch(/type-(?:title|display)|text-(?:base|lg|xl|2xl)/);
    }
  });

  it('keeps finished and sent-a-message summaries on identical collapsed geometry', async () => {
    const { rerender } = renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          type: 'agent:idle',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: { agentName: 'Builder' },
        },
      ],
    });
    const finishedHeaderClass = screen.getByTestId('event-wakeup-header').className;
    const finishedSummaryClass = screen.getByTestId('event-wakeup-summary').className;
    expect(screen.getByTestId('event-wakeup-status').textContent?.trim()).toBe('finished');

    await rerender({
      metadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:reportToParent'],
        events: [
          {
            type: 'agent:reportToParent',
            timestamp: '2026-08-12T12:00:00.000Z',
            data: { agentName: 'Builder' },
          },
        ],
      },
      asDivider: true,
      showAgentCards: false,
    });

    expect(screen.getByTestId('event-wakeup-status').textContent?.trim()).toBe('sent a message');
    expect(screen.getByTestId('event-wakeup-header').className).toBe(finishedHeaderClass);
    expect(screen.getByTestId('event-wakeup-summary').className).toBe(finishedSummaryClass);
  });

  it('retains useful legacy type and count-only fallbacks', async () => {
    const { rerender } = renderBanner({
      type: 'event_notification',
      eventCount: 2,
      eventTypes: ['file:updated', 'daemon:unknown'],
    });
    const summary = screen.getByTestId('event-wakeup-summary');
    await fireEvent.click(summary);
    expect(screen.getByTestId('event-wakeup-details').textContent).toContain('file changes');
    expect(screen.getByTestId('event-wakeup-details').textContent).toContain('daemon:unknown');

    await rerender({
      metadata: { type: 'event_notification', eventCount: 3, eventTypes: [] },
      asDivider: true,
      showAgentCards: false,
    });
    expect(screen.getByTestId('event-wakeup-details').textContent).toContain(
      '3 events triggered this response',
    );
  });

  it.each([
    ['one event', [{ type: 'agent:idle', data: { agentName: 'Alpha' } }], 'Alpha finished'],
    [
      'two events with failure',
      [
        { type: 'agent:idle', data: { agentName: 'Alpha' } },
        { type: 'agent:failed', data: { agentName: 'Beta' } },
      ],
      'Alpha finished & Beta failed',
    ],
    [
      'four ordered events with duplicate and attention',
      [
        { type: 'agent:idle', data: { agentName: 'Alpha' } },
        { type: 'agent:idle', data: { agentName: 'Alpha' } },
        { type: 'agent:status-changed', data: { agentName: 'Beta', status: 'waiting' } },
        { type: 'custom:unknown', data: {} },
      ],
      'Alpha finished & Beta is waiting & Custom unknown',
    ],
  ])('uses a descriptive, ordered, deduplicated header for %s', (_, events, expected) => {
    renderBanner({
      type: 'event_notification',
      eventCount: events.length,
      eventTypes: events.map((event) => event.type),
      events: events.map((event, index) => ({
        ...event,
        timestamp: `2026-08-16T03:0${index}:00.000Z`,
      })),
    });

    const summary = screen.getByTestId('event-wakeup-summary');
    expect(summary.getAttribute('aria-label')).toBe(expected);
    expect(within(summary).getByTitle(expected)).toBeTruthy();
  });

  it('keeps five-event bursts count-only and exposes the full truncated header accessibly', async () => {
    const events = Array.from({ length: 5 }, (_, index) => ({
      type: 'agent:completed',
      timestamp: `2026-08-16T03:0${index}:00.000Z`,
      data: { agentName: `Agent ${index}` },
    }));
    const { rerender } = renderBanner({
      type: 'event_notification',
      eventCount: events.length,
      eventTypes: events.map((event) => event.type),
      events,
    });
    expect(screen.getByTestId('event-wakeup-summary').getAttribute('aria-label')).toBe('5 events');

    const longName = 'Long agent identity '.repeat(8).trim();
    await rerender({
      metadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:failed'],
        events: [
          {
            type: 'agent:failed',
            timestamp: '2026-08-16T03:00:00.000Z',
            data: { agentName: longName },
          },
        ],
      },
      asDivider: true,
      showAgentCards: false,
    });
    const fullLabel = `${longName} failed`;
    expect(screen.getByTestId('event-wakeup-summary').getAttribute('aria-label')).toBe(fullLabel);
    expect(within(screen.getByTestId('event-wakeup-summary')).getByTitle(fullLabel)).toBeTruthy();
  });

  it('renders PR notifications and a navigable legacy completion avatar inside the same surface', async () => {
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    const { rerender } = renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['pull_request:updated'],
      events: [
        {
          type: 'pull_request:updated',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: { report: 'Checks completed' },
        },
      ],
    });
    await fireEvent.click(screen.getByTestId('event-wakeup-summary'));
    expect(screen.getByTestId('event-wakeup-details').textContent).toContain(
      'pull_request:updated',
    );
    expect(screen.getByTestId('event-wakeup-details').textContent).toContain('Checks completed');

    await rerender({
      metadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:reportToParent'],
      },
      messageText:
        '[WORKSPACE EVENTS]\n1. [agent:reportToParent] "Verifier" {{agentId:agent-verifier}} completed',
      asDivider: true,
      showAgentCards: true,
      workspace: WORKSPACE,
    });
    const avatar = screen.getByTestId('event-agent-avatar');
    expect(avatar.tagName).toBe('BUTTON');
    expect(avatar.getAttribute('data-agent-id')).toBe('agent-verifier');
    expect(screen.queryByTestId('event-wakeup-agent-list')).toBeNull();

    const summary = screen.getByTestId('event-wakeup-summary');
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(avatar, { detail: 0 });
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      openAgentTabRequested(WORKSPACE.id, {
        agentId: 'agent-verifier',
        sourcePanelId: undefined,
        openInAdjacentPanel: false,
      }),
    );
  });

  it('uses one completed header avatar without repeating identity in expanded details', async () => {
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    renderBanner(
      {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:idle'],
        events: [
          {
            type: 'agent:idle',
            timestamp: '2026-08-12T12:00:00.000Z',
            data: {
              agentId: 'agent-builder',
              agentName: 'Builder',
              completionReport: 'Implementation complete',
            },
          },
        ],
      },
      { showAgentCards: true, workspace: WORKSPACE },
    );

    const avatar = screen.getByTestId('event-agent-avatar');
    expect(avatar.getAttribute('data-completed')).toBe('true');
    expect(screen.queryByTestId('event-wakeup-agent-list')).toBeNull();
    await fireEvent.click(avatar);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('event-wakeup-summary').getAttribute('aria-expanded')).toBe('false');

    await fireEvent.click(screen.getByTestId('event-wakeup-summary'));
    const details = screen.getByTestId('event-wakeup-details');
    expect(details.textContent).toContain('Implementation complete');
    expect(details.textContent).not.toContain('Builder');
    expect(details.textContent).not.toContain('Agent finished');
  });

  it('uses the compact five-avatar stack and overflow treatment for multiple completions', () => {
    renderBanner(
      {
        type: 'event_notification',
        eventCount: 6,
        eventTypes: ['agent:idle'],
        events: Array.from({ length: 6 }, (_, index) => ({
          type: 'agent:idle',
          timestamp: `2026-08-12T12:0${index}:00.000Z`,
          data: { agentId: `agent-${index}`, agentName: `Agent ${index}` },
        })),
      },
      { showAgentCards: true, workspace: WORKSPACE },
    );

    expect(screen.getAllByTestId('event-agent-avatar')).toHaveLength(5);
    expect(screen.getByTestId('event-wakeup-avatar-overflow').textContent?.trim()).toBe('+1');
    expect(screen.queryByTestId('event-wakeup-agent-list')).toBeNull();
  });

  it('toggles exactly once for pointer and keyboard-generated native activation', async () => {
    renderBanner({ type: 'event_notification', eventCount: 1, eventTypes: [] });
    const summary = screen.getByTestId('event-wakeup-summary') as HTMLButtonElement;
    summary.focus();
    expect(document.activeElement).toBe(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('false');

    await fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    const detailsId = screen.getByTestId('event-wakeup-details').id;
    expect(summary.getAttribute('aria-controls')).toBe(detailsId);

    await fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('event-wakeup-details')).toBeNull();

    await fireEvent.click(summary, { detail: 0 });
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('event-wakeup-details')).toBeTruthy();
  });
});

describe('EventWakeupBanner agent-id suppression', () => {
  const AGENT_UUID = 'agent-579724c1-fe68-450e-8188-43b7afb964c6';

  it('renders the generic label, never the UUID, for a wake with agentId but no agentName', () => {
    renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          type: 'agent:idle',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: { agentId: AGENT_UUID },
        },
      ],
    });

    const summary = screen.getByTestId('event-wakeup-summary');
    expect(summary.getAttribute('aria-label')).toBe('Agent finished');
    expect(summary.textContent).not.toContain(AGENT_UUID);
  });

  it('rejects an id-shaped agentName and falls back to the generic label', () => {
    renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          type: 'agent:idle',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: { agentId: AGENT_UUID, agentName: AGENT_UUID },
        },
      ],
    });

    const summary = screen.getByTestId('event-wakeup-summary');
    expect(summary.getAttribute('aria-label')).toBe('Agent finished');
    expect(summary.textContent).not.toContain(AGENT_UUID);
  });

  it('resolves the display name from the live agent-session store when the event has only an id', () => {
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AGENT_UUID,
          workspaceId: WORKSPACE.id,
          name: 'Implementor',
          messages: [],
        } as unknown as AgentSession,
      ]),
    );

    renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          type: 'agent:idle',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: { agentId: AGENT_UUID },
        },
      ],
    });

    const summary = screen.getByTestId('event-wakeup-summary');
    expect(summary.getAttribute('aria-label')).toBe('Implementor finished');
    expect(screen.getByTestId('event-wakeup-agent-name').textContent?.trim()).toBe('Implementor');
  });

  it('parses the unquoted legacy "Child agent NAME (agent-id)" wording into the name', () => {
    renderBanner(
      {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:idle'],
      },
      {
        messageText: `[WORKSPACE EVENTS]\n1. [agent:idle] Child agent Builder (agent-00000000-0000-4000-8000-000000000000) completed.`,
        showAgentCards: true,
        workspace: WORKSPACE,
      },
    );

    const summary = screen.getByTestId('event-wakeup-summary');
    expect(summary.getAttribute('aria-label')).toBe('Builder finished');
    expect(summary.textContent).not.toContain('agent-00000000');
  });

  it('updates from the generic label to the resolved name when the session lands after render', async () => {
    const LATE_AGENT_UUID = 'agent-11111111-2222-4333-8444-555555555555';
    renderBanner({
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          type: 'agent:idle',
          timestamp: '2026-08-12T12:00:00.000Z',
          data: { agentId: LATE_AGENT_UUID },
        },
      ],
    });

    const summary = screen.getByTestId('event-wakeup-summary');
    expect(summary.getAttribute('aria-label')).toBe('Agent finished');

    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: LATE_AGENT_UUID,
          workspaceId: WORKSPACE.id,
          name: 'Late Loader',
          messages: [],
        } as unknown as AgentSession,
      ]),
    );
    await vi.waitFor(() => {
      expect(summary.getAttribute('aria-label')).toBe('Late Loader finished');
    });
  });
});
