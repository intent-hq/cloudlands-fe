/**
 * HudTakeoverOverlay tests — COMPLETE-cell report body (a complete task cell
 * fills its body with the completing agent's completionReport (session
 * metadata, §5.5), falling back to the task note's content; non-complete
 * cells and complete cells with neither source render no report block),
 * the status-update banner hierarchy (chip → workspace name headline →
 * status text subtitle), and the card→overlay takeover transition (pre-roll
 * blink publishes the card target while the overlay stays hidden; a missing
 * card falls back to an instant open; the frame zooms out of the measured
 * card rect).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  hydrateHardwareConsoleKeyPins,
  pinWorkspaceToKey,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { loadWorkspaceTasksSucceeded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { hydrateTaskAgentAssociations } from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import type { Note, Workspace, WorkspaceId, WorkspaceTask } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

import HudTakeoverOverlay from './HudTakeoverOverlay.svelte';
import { emitTakeoverTrigger, takeoverBlinkTarget } from './hud-takeover-bus';
import {
  HUD_TAKEOVER_BLINK_MS,
  HUD_TAKEOVER_CLOSE_MS,
  HUD_TAKEOVER_DWELL_MIN_MS,
  HUD_TAKEOVER_OPEN_MS,
} from './hud-takeover-queue';
import { takeoverPitchPx } from './hud-takeover-layout';
import { playHudSoundCue } from '../sound/hud-sound-player';

// The typewriter-cue suite asserts the overlay's timer-armed garnish call;
// playback itself is covered by hud-sound-player.test.ts.
vi.mock('../sound/hud-sound-player', () => ({
  playHudSoundCue: vi.fn(),
  playTakeoverTransitionCues: vi.fn(),
}));

// Controllable micro-connected gate for the header key square; defaults to
// disconnected, matching the real jsdom behavior (WebHID unavailable).
const hw = vi.hoisted(() => ({ connected: false }));
vi.mock('$features/hardware-console/device/connection-status', async () => {
  const { readable } = await import('svelte/store');
  return { microConnectedReadable: () => readable(hw.connected) };
});

const NOW_MS = Date.parse('2026-07-30T12:00:00Z');
const WS = 'ws-1';

function workspace(): Workspace {
  return {
    id: WS as WorkspaceId,
    title: 'Sidecar auto-update',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: 'in_progress',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as Workspace;
}

function seedTasks(tasks: Array<{ id: string; title: string; status: string }>): void {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'complete').length;
  appStore.dispatch(
    loadWorkspaceTasksSucceeded(WS, tasks as WorkspaceTask[], { total, completed, inProgress: 0 }),
  );
}

function openTakeover(): void {
  emitTakeoverTrigger({
    workspaceId: WS,
    kind: 'task_complete',
    detail: 'Port the fetch loop',
    raisedAtMs: NOW_MS,
    changedTaskId: null,
  });
  flushSync();
}

describe('HudTakeoverOverlay COMPLETE-cell report body', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('fills the complete cell with the linked agent completionReport (clamped block)', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'complete' }]);
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: 'a1',
          name: 'Implementor',
          workspaceId: WS,
          messages: [],
          metadata: { completionReport: 'Ported the loop; 12 tests green.' },
        },
      ] as never),
    );
    appStore.dispatch(
      hydrateTaskAgentAssociations(WS, {
        'task-1': {
          'agent:a1': {
            taskText: 'Port the fetch loop',
            taskKey: 'agent:a1',
            agentId: 'a1',
            noteId: 'task-1',
            createdAt: NOW_MS,
          },
        },
      }),
    );

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const report = screen.getByTestId('hud-takeover-cell-report');
    expect(report.textContent?.trim()).toBe('Ported the loop; 12 tests green.');
    expect(report.classList.contains('ov-cell-report')).toBe(true);
  });

  it('falls back to the task note content when no linked agent has a report', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'complete' }]);
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([WS], {
        [WS]: [
          {
            id: 'task-1',
            workspaceId: WS,
            title: 'Port the fetch loop',
            content: 'Objective: port the fetch loop.',
          } as Note,
        ],
      }),
    );

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(screen.getByTestId('hud-takeover-cell-report').textContent?.trim()).toBe(
      'Objective: port the fetch loop.',
    );
  });

  it('renders no report block on non-complete cells or when neither source has text', () => {
    seedTasks([
      { id: 'task-1', title: 'In flight', status: 'in_progress' },
      { id: 'task-2', title: 'Done, silent', status: 'complete' },
    ]);

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(screen.getAllByTestId('hud-takeover-cell')).toHaveLength(2);
    expect(screen.queryByTestId('hud-takeover-cell-report')).toBeNull();
  });
});

describe('HudTakeoverOverlay in-progress cell shimmer', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    appStore.dispose();
  });

  function cellByTitle(title: string): Element | undefined {
    return screen
      .getAllByTestId('hud-takeover-cell')
      .find((cell) => cell.querySelector('.ov-cell-title')?.textContent?.trim() === title);
  }

  it('applies the diagonal shimmer class to in-progress cells only', () => {
    seedTasks([
      { id: 'task-1', title: 'In flight', status: 'in_progress' },
      { id: 'task-2', title: 'Done', status: 'complete' },
      { id: 'task-3', title: 'Queued', status: 'not_started' },
    ]);

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(cellByTitle('In flight')?.classList.contains('ov-cell-shimmer')).toBe(true);
    expect(cellByTitle('Done')?.classList.contains('ov-cell-shimmer')).toBe(false);
    expect(cellByTitle('Queued')?.classList.contains('ov-cell-shimmer')).toBe(false);
  });

  it('skips the shimmer class entirely under reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    seedTasks([{ id: 'task-1', title: 'In flight', status: 'in_progress' }]);

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(screen.getByTestId('hud-takeover-cell').classList.contains('ov-cell-shimmer')).toBe(
      false,
    );
  });
});

describe('HudTakeoverOverlay header hardware-key square', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
  });
  afterEach(() => {
    hw.connected = false;
    cleanup();
    appStore.dispose();
  });

  function headerSquare(): Element | null {
    return document.querySelector('.ov-title-row .ov-key-square');
  }

  it('renders the slot square immediately before the workspace name when connected + slotted', () => {
    hw.connected = true;
    appStore.dispatch(pinWorkspaceToKey(2, WS));

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const square = headerSquare();
    const name = document.querySelector('.ov-ws-name');
    expect(square?.textContent?.trim()).toBe('3'); // 1-based slot number.
    expect(
      square && name && square.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders no square when the micro is disconnected', () => {
    appStore.dispatch(pinWorkspaceToKey(2, WS));

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(headerSquare()).toBeNull();
    expect(document.querySelector('.ov-ws-name')?.textContent?.trim()).toBe('Sidecar auto-update');
  });

  it('renders no square when the workspace holds no key slot', () => {
    hw.connected = true;
    // Exclude WS from auto-fill so it resolves to no slot.
    appStore.dispatch(hydrateHardwareConsoleKeyPins(new Array(6).fill(null), [WS]));

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(headerSquare()).toBeNull();
    expect(document.querySelector('.ov-ws-name')?.textContent?.trim()).toBe('Sidecar auto-update');
  });
});

describe('HudTakeoverOverlay status-update banner hierarchy', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('composes chip → workspace name headline → status text subtitle', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'status_update',
      detail: 'Implementing the toggle; 8 tasks to go.',
      raisedAtMs: NOW_MS,
      changedTaskId: null,
    });
    flushSync();

    const banner = screen.getByTestId('hud-takeover-banner');
    const chip = banner.querySelector('.ov-banner-chip');
    const headline = banner.querySelector('.ov-banner-big');
    const subtitle = screen.getByTestId('hud-takeover-banner-status');
    expect(chip?.textContent?.trim()).toBe('STATUS UPDATE');
    expect(headline?.textContent?.trim()).toBe('Sidecar auto-update');
    expect(subtitle.textContent?.trim()).toBe('Implementing the toggle; 8 tasks to go.');
    // Hierarchy order: chip above headline above subtitle.
    expect(
      chip && headline && chip.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      headline && headline.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The repo-ref sub-line is replaced by the status subtitle for this kind.
    expect(banner.querySelector('.ov-banner-sub')).toBeNull();
  });

  it('omits the subtitle when the status text is empty', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);

    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'status_update',
      detail: '',
      raisedAtMs: NOW_MS,
      changedTaskId: null,
    });
    flushSync();

    const banner = screen.getByTestId('hud-takeover-banner');
    expect(banner.querySelector('.ov-banner-big')?.textContent?.trim()).toBe('Sidecar auto-update');
    expect(screen.queryByTestId('hud-takeover-banner-status')).toBeNull();
  });

  // jsdom normalizes concrete hsl() colors to rgb, so the card's purple
  // prMerged accent (hsl(262 60% 62%)) asserts as its rgb serialization.
  it.each([
    ['workspace_idle', 'WORKSPACE IDLE', 'hsl(var(--muted-foreground) / 0.65)'],
    ['pr_open', 'PR OPEN', 'hsl(var(--ring))'],
    ['pr_ready', 'PR MERGEABLE', 'hsl(var(--ring))'],
    ['pr_queued', m.hud_takeover_kindPrQueued_label(), 'hsl(var(--ring))'],
    ['pr_merged', 'PR MERGED', 'rgb(143, 100, 216)'],
    ['workspace_complete', 'COMPLETE', 'hsl(var(--primary))'],
  ] as const)(
    'workspace displayStatus banner (%s): kind chip + workspace name headline, no subtitle',
    (kind, chipLabel, color) => {
      seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);

      render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
      emitTakeoverTrigger({
        workspaceId: WS,
        kind,
        detail: '',
        raisedAtMs: NOW_MS,
        changedTaskId: null,
      });
      flushSync();

      const banner = screen.getByTestId('hud-takeover-banner');
      const chip = banner.querySelector<HTMLElement>('.ov-banner-chip');
      expect(chip?.textContent?.trim()).toBe(chipLabel);
      expect(chip?.style.color).toBe(color);
      // Workspace title on the dot-matrix headline; no raw wire word, no
      // status subtitle, no repo-ref sub-line.
      expect(banner.querySelector('.ov-banner-big')?.textContent?.trim()).toBe(
        'Sidecar auto-update',
      );
      expect(screen.queryByTestId('hud-takeover-banner-status')).toBeNull();
      expect(banner.querySelector('.ov-banner-sub')).toBeNull();
    },
  );
});

describe('HudTakeoverOverlay attention banner (question / blocker / discussion)', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('question: dot-matrix headline is the raising agent name, sub-title the Q:-prefixed question', () => {
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'question_asked',
      detail: 'Which authentication method should the endpoint use?',
      raisedAtMs: NOW_MS,
      changedTaskId: null,
      agentName: 'Coordinator',
      signal: 'question',
    });
    flushSync();

    const banner = screen.getByTestId('hud-takeover-banner');
    const chip = banner.querySelector('.ov-banner-chip');
    const headline = banner.querySelector('.ov-banner-big');
    const subtitle = screen.getByTestId('hud-takeover-banner-attention');
    expect(chip?.textContent?.trim()).toBe('QUESTION');
    // The dot-matrix line (`.ov-banner-big`, rendered in the Doto dot-matrix
    // font) renders the AGENT name, not the question text.
    expect(headline?.textContent?.trim()).toBe('Coordinator');
    // Sub-title = the question text with the card footer's shared Q: prefix.
    expect(subtitle.textContent?.trim()).toBe(
      'Q: Which authentication method should the endpoint use?',
    );
    // The workspace name stays visible in the overlay header.
    expect(document.querySelector('.ov-ws-name')?.textContent?.trim()).toBe('Sidecar auto-update');
  });

  it('blocker/discussion: signal chip + prefixed reason sub-title', () => {
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'question_asked',
      detail: 'Sandbox network is down',
      raisedAtMs: NOW_MS,
      changedTaskId: null,
      agentName: 'Verifier',
      signal: 'blocker',
    });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'question_asked',
      detail: 'Need a call on the rollout order',
      raisedAtMs: NOW_MS + 1,
      changedTaskId: null,
      agentName: 'Coordinator',
      signal: 'discussion',
    });
    flushSync();

    const banners = screen.getAllByTestId('hud-takeover-banner');
    expect(banners).toHaveLength(2);
    const chips = banners.map((b) => b.querySelector('.ov-banner-chip')?.textContent?.trim());
    const heads = banners.map((b) => b.querySelector('.ov-banner-big')?.textContent?.trim());
    const subs = banners.map((b) =>
      b.querySelector('[data-testid="hud-takeover-banner-attention"]')?.textContent?.trim(),
    );
    expect(chips).toEqual(['BLOCKED', 'DISCUSSION REQUIRED']);
    expect(heads).toEqual(['Verifier', 'Coordinator']);
    expect(subs).toEqual([
      'Blocker: Sandbox network is down',
      'Request Discussion: Need a call on the rollout order',
    ]);
  });

  it('attention banner: fade-out delay allocates ~half the (attention-tier) dwell to the unfolded banner', () => {
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    // 100-char question → dwell 4000 + 60×100 = 10000ms. Unfold at 1.0s +
    // 1.1s wipe, hold dwell/2 = 5.0s → out-delay 7.10s.
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'question_asked',
      detail: 'q'.repeat(100),
      raisedAtMs: NOW_MS,
      changedTaskId: null,
      agentName: 'Coordinator',
      signal: 'question',
    });
    flushSync();
    const banner = screen.getByTestId('hud-takeover-banner');
    expect(banner.style.getPropertyValue('--banner-in-delay')).toBe('1.0s');
    expect(banner.style.getPropertyValue('--banner-out-delay')).toBe('7.10s');
  });

  it('routine banner: fade-out delay allocates ~half the (routine-tier) dwell', () => {
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    // Short detail clamps to the 3000ms routine floor dwell → hold 1.5s
    // after the 1.0s + 1.1s unfold → out-delay 3.60s.
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'task_complete',
      detail: 'Port the fetch loop',
      raisedAtMs: NOW_MS,
      changedTaskId: null,
    });
    flushSync();
    const banner = screen.getByTestId('hud-takeover-banner');
    expect(banner.style.getPropertyValue('--banner-in-delay')).toBe('1.0s');
    expect(banner.style.getPropertyValue('--banner-out-delay')).toBe('3.60s');
  });

  it('question with no resolvable agent name falls back to the workspace title on the matrix line', () => {
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'question_asked',
      detail: 'Rebuild or repin?',
      raisedAtMs: NOW_MS,
      changedTaskId: null,
      agentName: null,
      signal: 'question',
    });
    flushSync();

    const banner = screen.getByTestId('hud-takeover-banner');
    expect(banner.querySelector('.ov-banner-big')?.textContent?.trim()).toBe('Sidecar auto-update');
    expect(screen.getByTestId('hud-takeover-banner-attention').textContent?.trim()).toBe(
      'Q: Rebuild or repin?',
    );
  });
});

describe('HudTakeoverOverlay card→overlay transition', () => {
  /** Fake grid fixture: HUD shell + a source card with measurable rects. */
  function mountCardFixture(): void {
    const shell = document.createElement('div');
    shell.setAttribute('data-testid', 'hud-shell');
    shell.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1600, height: 900, right: 1600, bottom: 900 }) as DOMRect;
    const card = document.createElement('button');
    card.setAttribute('data-testid', 'hud-ws-card');
    card.setAttribute('data-workspace-id', WS);
    card.getBoundingClientRect = () =>
      ({ left: 100, top: 200, width: 296, height: 296, right: 396, bottom: 496 }) as DOMRect;
    shell.appendChild(card);
    document.body.appendChild(shell);
  }

  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    appStore.dispose();
    document.querySelector('[data-testid="hud-shell"]')?.remove();
  });

  it('pre-roll: blinks the source card while the overlay stays hidden, then opens', () => {
    mountCardFixture();
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    // Blinking: the card is the published flash target; no overlay yet.
    expect(get(takeoverBlinkTarget)).toBe(WS);
    expect(screen.queryByTestId('hud-takeover-overlay')).toBeNull();

    vi.advanceTimersByTime(HUD_TAKEOVER_BLINK_MS + 10);
    flushSync();
    expect(get(takeoverBlinkTarget)).toBeNull();
    expect(screen.getByTestId('hud-takeover-overlay')).toBeTruthy();
  });

  it('missing source card: skips the blink and opens instantly', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(get(takeoverBlinkTarget)).toBeNull();
    expect(screen.getByTestId('hud-takeover-overlay')).toBeTruthy();
  });

  it('frame zooms out of the measured card rect, then releases to center', () => {
    mountCardFixture();
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    vi.advanceTimersByTime(HUD_TAKEOVER_BLINK_MS + 10);
    flushSync();

    // Pinned to the card: translate by center offset, scale card/frame.
    // Frame box: min(1560, 1600−120)=1480 × min(850, 900−120)=780.
    const frame = screen.getByTestId('hud-takeover-frame');
    expect(frame.style.transform).toContain('translate(-50%, -50%)');
    expect(frame.style.transform).toContain('translate(-552.0px, -102.0px)');
    expect(frame.style.transform).toContain('scale(0.200, 0.379)');

    // 50ms later the frame releases to the centered CSS default with the
    // expand transition driving it there.
    vi.advanceTimersByTime(60);
    flushSync();
    expect(frame.style.transform).toBe('');
    expect(frame.style.transition).toContain('transform 0.5s');
  });
});

describe('HudTakeoverOverlay stalled-clock enqueue (controller regression)', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
    appStore.dispatch(
      setWorkspaceEntity({
        ...workspace(),
        id: 'ws-2' as WorkspaceId,
        title: 'Other workspace',
      } as Workspace),
    );
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    appStore.dispose();
  });

  it('an enqueue on a long-stale queue never synchronously replaces the displayed workspace', () => {
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover(); // No source card → instant open for ws-1.
    expect(screen.getByTestId('hud-takeover-overlay')).toBeTruthy();
    expect(document.querySelector('.ov-ws-name')?.textContent?.trim()).toBe('Sidecar auto-update');

    // The renderer stalls (e.g. throttled background tab): the wall clock
    // jumps far past every chained deadline without a phase timer firing.
    vi.setSystemTime(NOW_MS + 60_000);
    emitTakeoverTrigger({
      workspaceId: 'ws-2',
      kind: 'task_complete',
      detail: 'Other task done',
      raisedAtMs: NOW_MS + 60_000,
      changedTaskId: null,
    });
    flushSync();

    // ws-1 stays on screen; ws-2 waits behind the full close animation.
    expect(document.querySelector('.ov-ws-name')?.textContent?.trim()).toBe('Sidecar auto-update');
  });
});

describe('HudTakeoverOverlay map drag-to-pan', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    appStore.dispose();
  });

  /** jsdom has no PointerEvent ctor; the handlers only read mouse fields. */
  function pointer(el: Element, type: string, x: number, y: number): void {
    el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    flushSync();
  }

  function dragMap(map: Element, from: [number, number], to: [number, number]): void {
    pointer(map, 'pointerdown', from[0], from[1]);
    pointer(map, 'pointermove', to[0], to[1]);
    pointer(map, 'pointerup', to[0], to[1]);
  }

  function panTransform(): string {
    return (document.querySelector('.ov-map-pan') as HTMLElement).style.transform;
  }

  it('dragging the map updates the pan offset (grabbing cursor while down)', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const map = screen.getByTestId('hud-takeover-map');
    pointer(map, 'pointerdown', 500, 300);
    pointer(map, 'pointermove', 450, 280);
    // Camera moves opposite the pointer: content follows the drag.
    expect(panTransform()).toBe('translate(-50px, -20px)');
    expect(map.classList.contains('ov-map-dragging')).toBe(true);
    pointer(map, 'pointerup', 450, 280);
    expect(map.classList.contains('ov-map-dragging')).toBe(false);
    expect(panTransform()).toBe('translate(-50px, -20px)');
  });

  it('clamps the pan to the canvas bounds', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    // One rootless task at (1,0): bounds x −2…2, y −1…1 cells (base viewport),
    // in px × the corridor-only pitch (192 floor).
    const pitch = takeoverPitchPx(0);
    const map = screen.getByTestId('hud-takeover-map');
    dragMap(map, [500, 300], [-10_000, 10_000]);
    expect(panTransform()).toBe(`translate(${-2 * pitch}px, ${1 * pitch}px)`);
  });

  it('movement under the threshold stays a click; a real drag suppresses it', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const map = screen.getByTestId('hud-takeover-map');
    const cell = screen.getByTestId('hud-takeover-cell');
    const onCellClick = vi.fn();
    cell.addEventListener('click', onCellClick);

    // 4px travel: below the 6px threshold — no pan, click passes through.
    dragMap(map, [500, 300], [504, 300]);
    pointer(cell, 'click', 504, 300);
    expect(panTransform()).toBe('translate(0px, 0px)');
    expect(onCellClick).toHaveBeenCalledTimes(1);

    // Real drag: pan moves and the click under the pointer is swallowed.
    dragMap(map, [500, 300], [460, 300]);
    pointer(cell, 'click', 460, 300);
    expect(panTransform()).toBe('translate(-40px, 0px)');
    expect(onCellClick).toHaveBeenCalledTimes(1);

    // Only the first click after a drag is suppressed.
    pointer(cell, 'click', 460, 300);
    expect(onCellClick).toHaveBeenCalledTimes(2);
  });

  it('a manual drag cancels the pending auto-pan to a far changed cell', () => {
    // 12 rootless tasks share column x=1, rows −6…5: task-12 lands at
    // (1,5) — |y| ≥ 2 needs pan.
    seedTasks(
      Array.from({ length: 12 }, (_, i) => ({
        id: `task-${i + 1}`,
        title: `Task ${i + 1}`,
        status: 'in_progress',
      })),
    );
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'task_complete',
      detail: 'Task 12',
      raisedAtMs: NOW_MS,
      changedTaskId: 'task-12',
    });
    flushSync();

    // Drag before the 2s auto-pan fires; the auto-pan must not override it.
    const map = screen.getByTestId('hud-takeover-map');
    dragMap(map, [500, 300], [530, 310]);
    expect(panTransform()).toBe('translate(30px, 10px)');
    vi.advanceTimersByTime(2500);
    flushSync();
    expect(panTransform()).toBe('translate(30px, 10px)');
  });

  it('without a drag the auto-pan still glides to the far cell after 2s', () => {
    seedTasks(
      Array.from({ length: 12 }, (_, i) => ({
        id: `task-${i + 1}`,
        title: `Task ${i + 1}`,
        status: 'in_progress',
      })),
    );
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'task_complete',
      detail: 'Task 12',
      raisedAtMs: NOW_MS,
      changedTaskId: 'task-12',
    });
    flushSync();

    expect(panTransform()).toBe('translate(0px, 0px)');
    vi.advanceTimersByTime(2100);
    flushSync();
    // The 12 spec fan-out edges bundle onto one trunk lane in gutter v:0.5 →
    // pitch 196. Cell (1,5) → camera offset (196, 5·196); canvas negates.
    const pitch = takeoverPitchPx(1);
    expect(panTransform()).toBe(`translate(${-1 * pitch}px, ${-5 * pitch}px)`);
  });
});

describe('HudTakeoverOverlay dependency-graph map (placement + edges)', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
    vi.unstubAllGlobals();
  });

  function seedGraphTasks(
    tasks: Array<{
      id: string;
      title: string;
      status: string;
      dependsOn?: string[];
      conflictsWith?: string[];
      unmetDependsOn?: string[];
    }>,
  ): void {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'complete').length;
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(WS, tasks as WorkspaceTask[], {
        total,
        completed,
        inProgress: 0,
      }),
    );
  }

  it('places cells by the dependency layout: a chain runs left→right from the spec', () => {
    seedGraphTasks([
      { id: 'a', title: 'A', status: 'complete' },
      { id: 'b', title: 'B', status: 'in_progress', dependsOn: ['a'] },
      { id: 'c', title: 'C', status: 'not_started', dependsOn: ['b'], unmetDependsOn: ['b'] },
    ]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const cells = screen.getAllByTestId('hud-takeover-cell');
    const byTitle = new Map(
      cells.map((cell) => [cell.querySelector('.ov-cell-title')?.textContent?.trim(), cell]),
    );
    // Columns 1..3 on row 0 → left = x·pitch − 90 (corridor-only chain → 192 floor).
    const pitch = takeoverPitchPx(0);
    expect(byTitle.get('A')?.style.left).toBe(`${1 * pitch - 90}px`);
    expect(byTitle.get('B')?.style.left).toBe(`${2 * pitch - 90}px`);
    expect(byTitle.get('C')?.style.left).toBe(`${3 * pitch - 90}px`);
    for (const title of ['A', 'B', 'C']) {
      expect(byTitle.get(title)?.style.top).toBe(`${-90}px`);
    }
  });

  it('renders per-source colored dep paths, muted spec, and arrowless conflicts', () => {
    seedGraphTasks([
      { id: 'a', title: 'A', status: 'complete' },
      { id: 'b', title: 'B', status: 'in_progress', dependsOn: ['a'], conflictsWith: ['c'] },
      { id: 'c', title: 'C', status: 'not_started', dependsOn: ['b'], unmetDependsOn: ['b'] },
    ]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(screen.getByTestId('hud-takeover-edges')).toBeTruthy();
    const edges = screen.getAllByTestId('hud-takeover-edge');
    const kinds = edges.map((edge) => edge.getAttribute('data-kind')).sort();
    expect(kinds).toEqual(['conflict', 'dep', 'dep', 'spec']);

    // The b→c dep and the conflict both run b→c on the row-0 corridor,
    // straddling the centerline by ∓4px; corridor spread never widens the
    // gutter, so the pitch stays at the 192px floor.
    const pitch = takeoverPitchPx(0);
    const byD = new Map(edges.map((edge) => [edge.getAttribute('d'), edge]));
    const aToB = byD.get(`M${pitch + 90} -4L${2 * pitch - 92} -4`);
    const bToC = byD.get(`M${2 * pitch + 90} -4L${3 * pitch - 92} -4`);
    const conflict = byD.get(`M${2 * pitch + 90} 4L${3 * pitch - 92} 4`);
    const spec = edges.find((edge) => edge.getAttribute('data-kind') === 'spec');

    // Dep arrowheads take the SOURCE task's palette slot (input order: a=0, b=1);
    // the spec edge keeps the muted arrow, conflicts render none.
    expect(aToB?.getAttribute('marker-end')).toBe('url(#ov-edge-arrow-c0)');
    expect(bToC?.getAttribute('marker-end')).toBe('url(#ov-edge-arrow-c1)');
    expect(spec?.getAttribute('marker-end')).toBe('url(#ov-edge-arrow-spec)');
    expect(conflict?.getAttribute('data-kind')).toBe('conflict');
    expect(conflict?.getAttribute('marker-end')).toBeNull();

    // Consumption dimming: a→b enters in-progress b (dim); b→c enters
    // not-started c (full-strength); spec never dims; the b↔c conflict is
    // live (neither endpoint complete) so it stays full-strength and pulses.
    expect(aToB?.classList.contains('ov-edge-dim')).toBe(true);
    expect(bToC?.classList.contains('ov-edge-dim')).toBe(false);
    expect(spec?.classList.contains('ov-edge-dim')).toBe(false);
    expect(conflict?.classList.contains('ov-edge-dim')).toBe(false);
    expect(conflict?.getAttribute('data-pulse')).toBe('conflict');
    expect(conflict?.classList.contains('ov-edge-conflict-live')).toBe(true);
    expect(conflict?.classList.contains('ov-edge-pulse')).toBe(true);
    // c has an unmet dependency → its incoming dep edge never pulses green.
    for (const edge of [aToB, bToC, spec]) {
      expect(edge?.getAttribute('data-pulse')).toBeNull();
      expect(edge?.classList.contains('ov-edge-pulse')).toBe(false);
    }
  });

  it('hovering a task cell highlights every edge touching it; hover end restores', () => {
    seedGraphTasks([
      { id: 'a', title: 'A', status: 'complete' },
      { id: 'b', title: 'B', status: 'in_progress', dependsOn: ['a'], conflictsWith: ['c'] },
      { id: 'c', title: 'C', status: 'not_started', dependsOn: ['b'], unmetDependsOn: ['b'] },
    ]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const cells = screen.getAllByTestId('hud-takeover-cell');
    const cellByTitle = (title: string) =>
      cells.find((cell) => cell.querySelector('.ov-cell-title')?.textContent?.trim() === title)!;
    // jsdom has no PointerEvent ctor; the handlers read no pointer fields.
    const hover = (el: Element, type: string) => {
      el.dispatchEvent(new MouseEvent(type));
      flushSync();
    };

    const edges = screen.getAllByTestId('hud-takeover-edge');
    const spec = edges.find((edge) => edge.getAttribute('data-kind') === 'spec')!;
    const conflict = edges.find((edge) => edge.getAttribute('data-kind') === 'conflict')!;
    // Dep edges by source palette slot (input order: a=0, b=1).
    const aToB = edges.find((edge) => edge.getAttribute('marker-end') === 'url(#ov-edge-arrow-c0)')!;
    const bToC = edges.find((edge) => edge.getAttribute('marker-end') === 'url(#ov-edge-arrow-c1)')!;
    expect(edges).toHaveLength(4);

    // Hover B: incoming dep, outgoing dep, and the live conflict highlight;
    // the spec→a edge keeps its normal rendering.
    hover(cellByTitle('B'), 'pointerenter');
    expect(aToB.classList.contains('ov-edge-hover')).toBe(true);
    expect(bToC.classList.contains('ov-edge-hover')).toBe(true);
    expect(conflict.classList.contains('ov-edge-hover')).toBe(true);
    expect(spec.classList.contains('ov-edge-hover')).toBe(false);
    // Full-strength: the consumed a→b edge sheds its dim, the live conflict
    // its pulse (colors stay).
    expect(aToB.classList.contains('ov-edge-dim')).toBe(false);
    expect(conflict.classList.contains('ov-edge-pulse')).toBe(false);
    expect(conflict.classList.contains('ov-edge-conflict-live')).toBe(true);

    // Hover end restores normal rendering.
    hover(cellByTitle('B'), 'pointerleave');
    for (const edge of edges) {
      expect(edge.classList.contains('ov-edge-hover')).toBe(false);
    }
    expect(aToB.classList.contains('ov-edge-dim')).toBe(true);
    expect(conflict.classList.contains('ov-edge-pulse')).toBe(true);

    // Hover A: its spec edge highlights too (matched via the destination).
    hover(cellByTitle('A'), 'pointerenter');
    expect(spec.classList.contains('ov-edge-hover')).toBe(true);
    expect(aToB.classList.contains('ov-edge-hover')).toBe(true);
    expect(bToC.classList.contains('ov-edge-hover')).toBe(false);
    expect(conflict.classList.contains('ov-edge-hover')).toBe(false);
  });

  it('arrowhead markers are fixed user-space size (immune to hover stroke thickening)', () => {
    seedGraphTasks([
      { id: 'a', title: 'A', status: 'complete' },
      { id: 'b', title: 'B', status: 'not_started', dependsOn: ['a'] },
    ]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    // markerUnits="userSpaceOnUse" keeps arrowheads at a constant size when
    // the hovered edge stroke thickens (default strokeWidth units would
    // scale them with the stroke); 10.5 matches the pre-hover appearance
    // (7 marker units × 1.5 stroke).
    const markers = screen.getByTestId('hud-takeover-edges').querySelectorAll('defs marker');
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker.getAttribute('markerUnits')).toBe('userSpaceOnUse');
      expect(marker.getAttribute('markerWidth')).toBe('10.5');
      expect(marker.getAttribute('markerHeight')).toBe('10.5');
    }
  });

  it('pulses ready dep edges green and mutes resolved conflicts', () => {
    // b is ready: deps met (no unmetDependsOn), not started. The a↔b
    // conflict is resolved (a complete) → static muted.
    seedGraphTasks([
      { id: 'a', title: 'A', status: 'complete' },
      { id: 'b', title: 'B', status: 'not_started', dependsOn: ['a'], conflictsWith: ['a'] },
    ]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const edges = screen.getAllByTestId('hud-takeover-edge');
    const dep = edges.find((edge) => edge.getAttribute('data-kind') === 'dep');
    const conflict = edges.find((edge) => edge.getAttribute('data-kind') === 'conflict');

    expect(dep?.getAttribute('data-pulse')).toBe('ready');
    expect(dep?.getAttribute('marker-end')).toBe('url(#ov-edge-arrow-ready)');
    expect(dep?.classList.contains('ov-edge-ready')).toBe(true);
    expect(dep?.classList.contains('ov-edge-pulse')).toBe(true);
    expect(dep?.classList.contains('ov-edge-dim')).toBe(false);

    expect(conflict?.getAttribute('data-pulse')).toBeNull();
    expect(conflict?.classList.contains('ov-edge-conflict-live')).toBe(false);
    expect(conflict?.classList.contains('ov-edge-pulse')).toBe(false);
    expect(conflict?.classList.contains('ov-edge-dim')).toBe(true);
  });

  it('reduced motion: pulse colors stay, the animation class does not apply', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    seedGraphTasks([
      { id: 'a', title: 'A', status: 'in_progress' },
      { id: 'b', title: 'B', status: 'not_started', dependsOn: ['a'], conflictsWith: ['a'] },
      { id: 'c', title: 'C', status: 'not_started', dependsOn: ['a'], unmetDependsOn: [] },
    ]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const edges = screen.getAllByTestId('hud-takeover-edge');
    const conflict = edges.find((edge) => edge.getAttribute('data-kind') === 'conflict');
    const ready = edges.find((edge) => edge.getAttribute('data-pulse') === 'ready');

    // Same static treatment (colors/markers), no pulse animation class.
    expect(conflict?.getAttribute('data-pulse')).toBe('conflict');
    expect(conflict?.classList.contains('ov-edge-conflict-live')).toBe(true);
    expect(ready?.classList.contains('ov-edge-ready')).toBe(true);
    expect(ready?.getAttribute('marker-end')).toBe('url(#ov-edge-arrow-ready)');
    for (const edge of edges) {
      expect(edge.classList.contains('ov-edge-pulse')).toBe(false);
    }
  });

  it('dims the dep edge into a complete dependent (no unmet override anymore)', () => {
    seedGraphTasks([
      { id: 'a', title: 'A', status: 'in_progress' },
      { id: 'b', title: 'B', status: 'complete', dependsOn: ['a'], unmetDependsOn: ['a'] },
    ]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const edges = screen.getAllByTestId('hud-takeover-edge');
    expect(edges.map((edge) => edge.getAttribute('data-kind')).sort()).toEqual(['dep', 'spec']);
    const dep = edges.find((edge) => edge.getAttribute('data-kind') === 'dep');
    expect(dep?.getAttribute('marker-end')).toBe('url(#ov-edge-arrow-c0)');
    expect(dep?.classList.contains('ov-edge-dim')).toBe(true);
  });

  it('renders no edge layer when the workspace has no tasks', () => {
    seedGraphTasks([]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(screen.queryByTestId('hud-takeover-edges')).toBeNull();
  });
});

describe('HudTakeoverOverlay map zoom (default 1:1)', () => {
  // jsdom has no layout: mock the map clip's client size so the per-display
  // viewport measurement sees a real box (needsPan evaluates against it).
  const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;
  const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get(this: Element) {
        return this.classList.contains('ov-map-clip') ? 1000 : 0;
      },
    });
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get(this: Element) {
        return this.classList.contains('ov-map-clip') ? 600 : 0;
      },
    });
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
    vi.useFakeTimers();
  });
  afterEach(() => {
    Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
    Object.defineProperty(Element.prototype, 'clientHeight', originalClientHeight);
    vi.useRealTimers();
    cleanup();
    appStore.dispose();
  });

  function panTransform(): string {
    return (document.querySelector('.ov-map-pan') as HTMLElement).style.transform;
  }

  /** Chain t1→…→t5 spans columns 1..5 (corridor-only → pitch 192); half-extent 5·192+90=1050 vs the 500px half-viewport. */
  function seedWideChain(): void {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i + 1}`,
      title: `T${i + 1}`,
      status: 'in_progress',
      ...(i > 0 ? { dependsOn: [`t${i}`] } : {}),
    }));
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(WS, tasks as WorkspaceTask[], {
        total: 5,
        completed: 0,
        inProgress: 5,
      }),
    );
  }

  it('renders 1:1 by default even for a graph wider than the viewport (no auto-fit)', () => {
    seedWideChain();
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(panTransform()).toBe('translate(0px, 0px)');
  });

  it('a small graph keeps the 1:1 transform (never scales up)', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    expect(panTransform()).toBe('translate(0px, 0px)');
  });

  it('auto-pans to a far changed cell at 1:1 (the graph no longer auto-fits)', () => {
    seedWideChain();
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    // t5 sits at (5,0) — cellNeedsPan true, and at 1:1 the chain overflows
    // the 1000px viewport, so the glide onto the changed cell takes over.
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'task_complete',
      detail: 'T5',
      raisedAtMs: NOW_MS,
      changedTaskId: 't5',
    });
    flushSync();

    expect(panTransform()).toBe('translate(0px, 0px)');
    vi.advanceTimersByTime(2500);
    flushSync();
    expect(panTransform()).toBe(`translate(${-5 * takeoverPitchPx(0)}px, 0px)`);
  });
});

describe('HudTakeoverOverlay map zoom controls (bottom-right cluster)', () => {
  // Same measured-viewport mock as the zoom suite: 1000×600 map clip.
  const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;
  const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get(this: Element) {
        return this.classList.contains('ov-map-clip') ? 1000 : 0;
      },
    });
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get(this: Element) {
        return this.classList.contains('ov-map-clip') ? 600 : 0;
      },
    });
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
    vi.useFakeTimers();
  });
  afterEach(() => {
    Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
    Object.defineProperty(Element.prototype, 'clientHeight', originalClientHeight);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cleanup();
    appStore.dispose();
  });

  function panTransform(): string {
    return (document.querySelector('.ov-map-pan') as HTMLElement).style.transform;
  }

  function button(id: string): HTMLButtonElement {
    return screen.getByTestId(id) as HTMLButtonElement;
  }

  function click(id: string): void {
    button(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
  }

  it('renders fit / − / + / 100% outside the drag clip', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const map = screen.getByTestId('hud-takeover-map');
    const ids = [
      'hud-takeover-zoom-fit',
      'hud-takeover-zoom-out',
      'hud-takeover-zoom-in',
      'hud-takeover-zoom-reset',
    ];
    for (const id of ids) {
      const btn = button(id);
      expect(btn.getAttribute('aria-label')).toBeTruthy();
      // Sibling of the clip, not inside it: pointer events on the buttons
      // never reach the drag/click-suppression handlers.
      expect(map.contains(btn)).toBe(false);
    }
    expect(button('hud-takeover-zoom-in').disabled).toBe(false);
    expect(button('hud-takeover-zoom-out').disabled).toBe(false);
  });

  it('+/− step the scale multiplicatively; 100% resets to 1:1', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    click('hud-takeover-zoom-in');
    expect(panTransform()).toBe('translate(0px, 0px) scale(1.25)');
    click('hud-takeover-zoom-in');
    expect(panTransform()).toBe('translate(0px, 0px) scale(1.563)');

    click('hud-takeover-zoom-reset');
    expect(panTransform()).toBe('translate(0px, 0px)');

    click('hud-takeover-zoom-out');
    expect(panTransform()).toBe('translate(0px, 0px) scale(0.8)');
  });

  it('FIT shrinks a wide chain to the measured viewport', () => {
    // Chain t1→…→t5 spans columns 1..5 (corridor-only → pitch 192); half-extent
    // 5·192+90=1050 vs the 500px half-viewport → fit scale 500/1050 = 0.476.
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i + 1}`,
      title: `T${i + 1}`,
      status: 'in_progress',
      ...(i > 0 ? { dependsOn: [`t${i}`] } : {}),
    }));
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(WS, tasks as WorkspaceTask[], {
        total: 5,
        completed: 0,
        inProgress: 5,
      }),
    );
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    click('hud-takeover-zoom-fit');
    expect(panTransform()).toBe('translate(0px, 0px) scale(0.476)');
  });

  it('+/− disable at the zoom limits', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    // 1 → 1.25 → 1.563 → 1.954 → 2 (clamped max).
    for (let i = 0; i < 4; i++) click('hud-takeover-zoom-in');
    expect(panTransform()).toBe('translate(0px, 0px) scale(2)');
    expect(button('hud-takeover-zoom-in').disabled).toBe(true);
    expect(button('hud-takeover-zoom-out').disabled).toBe(false);

    click('hud-takeover-zoom-reset');
    expect(button('hud-takeover-zoom-in').disabled).toBe(false);

    // 7 downward steps land on the 0.25 floor.
    for (let i = 0; i < 7; i++) click('hud-takeover-zoom-out');
    expect(panTransform()).toBe('translate(0px, 0px) scale(0.25)');
    expect(button('hud-takeover-zoom-out').disabled).toBe(true);
    expect(button('hud-takeover-zoom-in').disabled).toBe(false);
  });

  it('exposes the cluster as a labelled group for screen readers', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const cluster = screen.getByTestId('hud-takeover-zoom');
    expect(cluster.getAttribute('role')).toBe('group');
    expect(cluster.getAttribute('aria-label')).toBe('Map zoom');
  });

  it('manual zoom after open never resets the pan or re-schedules the auto-pan (latched needsPan)', () => {
    // Chain t1..t5: t5 at (5,0) is far and the chain overflows the 1000px
    // viewport at 1:1 → needsPan latches true at open.
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i + 1}`,
      title: `T${i + 1}`,
      status: 'in_progress',
      ...(i > 0 ? { dependsOn: [`t${i}`] } : {}),
    }));
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(WS, tasks as WorkspaceTask[], {
        total: 5,
        completed: 0,
        inProgress: 5,
      }),
    );
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'task_complete',
      detail: 'T5',
      raisedAtMs: NOW_MS,
      changedTaskId: 't5',
    });
    flushSync();

    // Pan-delayed banner timing from the latched decision.
    const banner = screen.getByTestId('hud-takeover-banner');
    expect(banner.style.getPropertyValue('--banner-in-delay')).toBe('3.5s');

    // The scheduled 2s glide lands on the changed cell (5,0).
    vi.advanceTimersByTime(2100);
    flushSync();
    expect(panTransform()).toBe(`translate(${-5 * takeoverPitchPx(0)}px, 0px)`);

    // Manual drag to a custom camera position.
    const map = screen.getByTestId('hud-takeover-map');
    for (const [type, x, y] of [
      ['pointerdown', 500, 300],
      ['pointermove', 530, 310],
      ['pointerup', 530, 310],
    ] as const) {
      map.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
      flushSync();
    }
    expect(panTransform()).toBe('translate(-930px, 10px)');

    // FIT makes the whole graph visible: the latched decision must not flip
    // (which would re-key syncAutoPan and snap the manual pan to {0,0}).
    click('hud-takeover-zoom-fit');
    expect(panTransform()).toBe(
      `translate(${-930 * 0.476}px, ${10 * 0.476}px) scale(0.476)`,
    );
    // Banner timing never flips mid-display either.
    expect(banner.style.getPropertyValue('--banner-in-delay')).toBe('3.5s');

    // Zooming back to 100% must not re-schedule a surprise 2s glide.
    click('hud-takeover-zoom-reset');
    expect(panTransform()).toBe('translate(-930px, 10px)');
    vi.advanceTimersByTime(2500);
    flushSync();
    expect(panTransform()).toBe('translate(-930px, 10px)');
  });

  it('reduced motion: a chained second takeover for the same workspace re-opens at 100%', () => {
    // prefers-reduced-motion disables the pre-roll blink, so the queue
    // chains closing → opening directly — no idle/blinking phase resets the
    // measurement between the two displays. The spec still requires every
    // open to start at 100% zoom.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover(); // blink:false → instant open.

    click('hud-takeover-zoom-in');
    expect(panTransform()).toBe('translate(0px, 0px) scale(1.25)');

    // A trigger for the SAME workspace queues at the front and re-opens
    // right after the close ('Port the fetch loop' dwells the 3s minimum).
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'task_complete',
      detail: 'Port the fetch loop',
      raisedAtMs: NOW_MS + 100,
      changedTaskId: null,
    });
    flushSync();
    vi.advanceTimersByTime(
      HUD_TAKEOVER_OPEN_MS + HUD_TAKEOVER_DWELL_MIN_MS + HUD_TAKEOVER_CLOSE_MS + 50,
    );
    flushSync();

    expect(screen.getByTestId('hud-takeover-overlay')).toBeTruthy();
    expect(panTransform()).toBe('translate(0px, 0px)');
  });

  it('a drag gesture across a control never suppresses its click', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    // Pointer travel over the button (well past the 6px drag threshold):
    // the cluster sits outside .ov-map-clip, so the drag controller never
    // sees it — no pan, and the button's click still lands.
    const zoomIn = button('hud-takeover-zoom-in');
    for (const [type, x] of [
      ['pointerdown', 500],
      ['pointermove', 440],
      ['pointerup', 440],
    ] as const) {
      zoomIn.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 300, bubbles: true }));
      flushSync();
    }
    expect(panTransform()).toBe('translate(0px, 0px)');

    click('hud-takeover-zoom-in');
    expect(panTransform()).toBe('translate(0px, 0px) scale(1.25)');
  });
});

describe('HudTakeoverOverlay headline overflow marquee', () => {
  // jsdom has no layout: mock scrollWidth/clientWidth so `.ov-banner-big`
  // reports `overflowPx` of horizontal overflow (0 for everything else,
  // jsdom's default). Mutable so per-entry-reset can change it mid-test;
  // `overflowPxPerBanner` overrides per headline (document order) for
  // stacked-banner tests.
  let overflowPx = 0;
  let overflowPxPerBanner: number[] | null = null;
  const originalScrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')!;
  const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;

  beforeEach(() => {
    overflowPx = 0;
    overflowPxPerBanner = null;
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get(this: Element) {
        if (!this.classList.contains('ov-banner-big')) return 0;
        if (overflowPxPerBanner) {
          const bigs = Array.from(document.querySelectorAll('.ov-banner-big'));
          return 600 + (overflowPxPerBanner[bigs.indexOf(this)] ?? 0);
        }
        return 600 + overflowPx;
      },
    });
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get(this: Element) {
        return this.classList.contains('ov-banner-big') ? 600 : 0;
      },
    });
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    Object.defineProperty(Element.prototype, 'scrollWidth', originalScrollWidth);
    Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cleanup();
    appStore.dispose();
    document.querySelector('[data-testid="hud-shell"]')?.remove();
  });

  function returnLabel(): string {
    return screen.getByTestId('hud-takeover-return').textContent?.trim() ?? '';
  }

  it('overflowing headline: marquee vars + shifted fade-out + extended dwell', () => {
    // 300px overflow → scroll 300/75 = 4.0s travel + 2×0.6s holds = 5.2s.
    overflowPx = 300;
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover(); // No source card → instant open at NOW_MS.

    const banner = screen.getByTestId('hud-takeover-banner');
    const marquee = screen.getByTestId('hud-takeover-banner-marquee');
    expect(marquee.classList.contains('ov-banner-marquee')).toBe(true);
    expect(marquee.style.getPropertyValue('--banner-scroll-px')).toBe('300px');
    expect(marquee.style.getPropertyValue('--banner-scroll-s')).toBe('4.00s');
    // Scroll starts after in-delay 1.0s + 1.1s wipe + 0.6s head hold.
    expect(marquee.style.getPropertyValue('--banner-scroll-delay')).toBe('2.70s');
    // Fade-out shifted by the 5.2s scroll: 1.0 + 1.1 + 5.2 + dwell/2 (1.5).
    expect(banner.style.getPropertyValue('--banner-out-delay')).toBe('8.80s');

    // Opening→dwelling tick at +1.2s: dwell = 3000 (routine floor) + 5200
    // extra → phase ends NOW+9400; the RETURN countdown reads it directly.
    vi.advanceTimersByTime(1250);
    flushSync();
    expect(returnLabel()).toBe('RETURN 00:10');
  });

  it('fitting headline: no marquee, timings byte-identical to today', () => {
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    const banner = screen.getByTestId('hud-takeover-banner');
    expect(screen.queryByTestId('hud-takeover-banner-marquee')).toBeNull();
    expect(banner.style.getPropertyValue('--banner-out-delay')).toBe('3.60s');

    // Un-extended dwell: 1200 + 3000 → phase ends NOW+4200.
    vi.advanceTimersByTime(1250);
    flushSync();
    expect(returnLabel()).toBe('RETURN 00:05');
  });

  it('wrapping headline never gets a marquee even when it overflows', () => {
    overflowPx = 300;
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'question_asked',
      detail: 'A long non-signal question sentence that wraps instead of clipping.',
      raisedAtMs: NOW_MS,
      changedTaskId: null,
    });
    flushSync();

    const banner = screen.getByTestId('hud-takeover-banner');
    expect(banner.querySelector('.ov-banner-big-wrap')).not.toBeNull();
    expect(screen.queryByTestId('hud-takeover-banner-marquee')).toBeNull();
  });

  it('reduced motion: no marquee, no dwell extension, animation-free banners', () => {
    overflowPx = 300;
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover(); // blink:false → instant open.

    expect(screen.getByTestId('hud-takeover-overlay').classList.contains('ov-no-motion')).toBe(
      true,
    );
    expect(screen.queryByTestId('hud-takeover-banner-marquee')).toBeNull();

    vi.advanceTimersByTime(1250);
    flushSync();
    expect(returnLabel()).toBe('RETURN 00:05');
  });

  it('measurement resets per entry: the next takeover never inherits the scroll', () => {
    appStore.dispatch(
      setWorkspaceEntity({
        ...workspace(),
        id: 'ws-2' as WorkspaceId,
        title: 'Other workspace',
      } as Workspace),
    );
    overflowPx = 300;
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover(); // ws-1: measured 300px → 5200ms extra dwell.
    expect(screen.getByTestId('hud-takeover-banner-marquee')).toBeTruthy();

    vi.advanceTimersByTime(1250); // dwelling, ends NOW+9400.
    flushSync();
    expect(returnLabel()).toBe('RETURN 00:10');

    // Queue ws-2 (fits: no overflow), dismiss ws-1 → close 950ms → ws-2 opens.
    overflowPx = 0;
    emitTakeoverTrigger({
      workspaceId: 'ws-2',
      kind: 'task_complete',
      detail: 'Other task done',
      raisedAtMs: NOW_MS + 1250,
      changedTaskId: null,
    });
    flushSync();
    screen.getByTestId('hud-takeover-dismiss').click();
    flushSync();
    vi.advanceTimersByTime(960); // Close ends NOW+2200 → ws-2 instant open.
    flushSync();
    expect(document.querySelector('.ov-ws-name')?.textContent?.trim()).toBe('Other workspace');
    expect(screen.queryByTestId('hud-takeover-banner-marquee')).toBeNull();

    // ws-2 dwell = un-extended 3000: opening ends NOW+3400, dwell NOW+6400 —
    // a leaked 5200ms measurement would read RETURN 00:12 here.
    vi.advanceTimersByTime(1250);
    flushSync();
    expect(returnLabel()).toBe('RETURN 00:07');
  });

  it('stacked banners: the LONGEST scroll wins the dwell extension (Math.max)', () => {
    // Stacking needs the pre-roll: same-workspace triggers coalesce only
    // while 'blinking', which needs a measurable source card.
    const shell = document.createElement('div');
    shell.setAttribute('data-testid', 'hud-shell');
    shell.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1600, height: 900, right: 1600, bottom: 900 }) as DOMRect;
    const card = document.createElement('button');
    card.setAttribute('data-testid', 'hud-ws-card');
    card.setAttribute('data-workspace-id', WS);
    card.getBoundingClientRect = () =>
      ({ left: 100, top: 200, width: 296, height: 296, right: 396, bottom: 496 }) as DOMRect;
    shell.appendChild(card);
    document.body.appendChild(shell);

    // Banner 0 scrolls 300px (300/75 + 1.2 = 5.2s), banner 1 only 150px
    // (150/75 + 1.2 = 3.2s): the LAST measured is the shorter one, so a
    // last-report-wins bug would extend by 3.2s instead of max 5.2s.
    overflowPxPerBanner = [300, 150];
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover(); // Trigger 1 → 'blinking' (card found).
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'task_complete',
      detail: 'Ship it',
      raisedAtMs: NOW_MS + 10,
      changedTaskId: null,
    });
    flushSync(); // Coalesces into the blinking entry → 2 stacked banners.

    vi.advanceTimersByTime(HUD_TAKEOVER_BLINK_MS + 10); // → 'opening' @ +630.
    flushSync();
    const marquees = screen.getAllByTestId('hud-takeover-banner-marquee');
    expect(marquees).toHaveLength(2);
    expect(marquees[0].style.getPropertyValue('--banner-scroll-px')).toBe('300px');
    expect(marquees[0].style.getPropertyValue('--banner-scroll-s')).toBe('4.00s');
    expect(marquees[1].style.getPropertyValue('--banner-scroll-px')).toBe('150px');
    expect(marquees[1].style.getPropertyValue('--banner-scroll-s')).toBe('2.00s');

    // Opening ends 630+1200=1830; dwell = 3300 (26 chars) + max(5200, 3200)
    // extra → ends NOW+10330 → RETURN 00:11. A last-report-wins bug (extra
    // 3200) would read 00:09; no extension at all would read 00:06.
    vi.advanceTimersByTime(1250);
    flushSync();
    expect(returnLabel()).toBe('RETURN 00:11');
  });
});

describe('HudTakeoverOverlay banner-typewriter sound cue', () => {
  beforeEach(() => {
    vi.mocked(playHudSoundCue).mockClear();
    appStore.init();
    appStore.dispatch(setWorkspaceEntity(workspace()));
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cleanup();
    appStore.dispose();
  });

  it('fires once when the banner wipe-in starts (1.0s after opening, no pan)', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover(); // No source card → instant open.

    vi.advanceTimersByTime(950);
    expect(playHudSoundCue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(playHudSoundCue).toHaveBeenCalledExactlyOnceWith('banner-typewriter');

    // Dwelling never re-arms the fired timer.
    vi.advanceTimersByTime(2000);
    flushSync();
    expect(playHudSoundCue).toHaveBeenCalledTimes(1);
  });

  it('waits for the 3.5s map pan pre-roll when the changed cell is far', () => {
    // 12 tasks: task-12 sits at seed coord (0,−2) — |y| ≥ 2 needs pan, so
    // the banner (and its cue) start at 3.5s, mid-'dwelling'.
    seedTasks(
      Array.from({ length: 12 }, (_, i) => ({
        id: `task-${i + 1}`,
        title: `Task ${i + 1}`,
        status: 'in_progress',
      })),
    );
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    emitTakeoverTrigger({
      workspaceId: WS,
      kind: 'task_complete',
      detail: 'Task 12',
      raisedAtMs: NOW_MS,
      changedTaskId: 'task-12',
    });
    flushSync();

    vi.advanceTimersByTime(3400); // Past opening→dwelling (1.2s); before 3.5s.
    flushSync();
    expect(playHudSoundCue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(playHudSoundCue).toHaveBeenCalledExactlyOnceWith('banner-typewriter');
  });

  it('cancels the pending cue when the display is dismissed before the wipe', () => {
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    screen.getByTestId('hud-takeover-dismiss').click();
    flushSync();
    vi.advanceTimersByTime(1500);
    expect(playHudSoundCue).not.toHaveBeenCalled();
  });

  // NOTE: manual VIEWER cue behavior (structural transients only, no kind
  // cue) is not renderable here — the redux card-click request flows through
  // an argument-less cached selector readable that freezes across this
  // file's store dispose/init cycles (viewer choreography is queue-tested in
  // hud-takeover-queue.test.ts). The cue-map viewer tests cover it.

  it('stays silent under reduced motion (banners render with no wipe)', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    vi.advanceTimersByTime(4000);
    expect(playHudSoundCue).not.toHaveBeenCalled();
  });

  it('cancels the armed timer when reduced motion flips on before the wipe', () => {
    // Motion allowed at open → timer armed; the preference then flips to
    // reduced before the 1.0s wipe start → banners re-render with no wipe,
    // so the pending cue must not fire.
    let onChange: ((event: { matches: boolean }) => void) | undefined;
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn((_: string, cb: (event: { matches: boolean }) => void) => {
          onChange = cb;
        }),
        removeEventListener: vi.fn(),
      }),
    );
    seedTasks([{ id: 'task-1', title: 'Port the fetch loop', status: 'in_progress' }]);
    render(HudTakeoverOverlay, { props: { nowMs: NOW_MS } });
    openTakeover();

    vi.advanceTimersByTime(500); // Timer armed, wipe not started.
    onChange?.({ matches: true }); // prefers-reduced-motion flips on.
    flushSync();
    vi.advanceTimersByTime(3500);
    expect(playHudSoundCue).not.toHaveBeenCalled();
  });
});
