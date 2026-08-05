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
import { loadWorkspaceTasksSucceeded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { hydrateTaskAgentAssociations } from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import type { Note, Workspace, WorkspaceId, WorkspaceTask } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudTakeoverOverlay from './HudTakeoverOverlay.svelte';
import { emitTakeoverTrigger, takeoverBlinkTarget } from './hud-takeover-bus';
import { HUD_TAKEOVER_BLINK_MS } from './hud-takeover-queue';
import { HUD_TAKEOVER_PITCH_PX } from './hud-takeover-layout';

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
    expect(banner.querySelector('.ov-banner-big')?.textContent?.trim()).toBe(
      'Sidecar auto-update',
    );
    expect(screen.queryByTestId('hud-takeover-banner-status')).toBeNull();
  });

  // jsdom normalizes concrete hsl() colors to rgb, so the card's purple
  // prMerged accent (hsl(262 60% 62%)) asserts as its rgb serialization.
  it.each([
    ['workspace_idle', 'WORKSPACE IDLE', 'hsl(var(--text-ghost))'],
    ['pr_open', 'PR OPEN', 'hsl(var(--ring))'],
    ['pr_ready', 'PR MERGEABLE', 'hsl(var(--ring))'],
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
    expect(document.querySelector('.ov-ws-name')?.textContent?.trim()).toBe(
      'Sidecar auto-update',
    );
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
    const subs = banners.map(
      (b) =>
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
    expect(banner.querySelector('.ov-banner-big')?.textContent?.trim()).toBe(
      'Sidecar auto-update',
    );
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
    el.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }),
    );
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

    // One task at (0,−1): bounds x −2…2, y −2…1 cells (± ring), in px ×192.
    const map = screen.getByTestId('hud-takeover-map');
    dragMap(map, [500, 300], [-10_000, 10_000]);
    expect(panTransform()).toBe(
      `translate(${-2 * HUD_TAKEOVER_PITCH_PX}px, ${2 * HUD_TAKEOVER_PITCH_PX}px)`,
    );
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
    // 12 tasks: task-12 sits at seed coord (0,−2) — |y| ≥ 2 needs pan.
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
    // Cell (0,−2) → camera offset (0, −2·192); canvas translates the negation.
    expect(panTransform()).toBe(`translate(0px, ${2 * HUD_TAKEOVER_PITCH_PX}px)`);
  });
});
