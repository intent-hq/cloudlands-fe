import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import manifestJson from './fixtures/intent-manifest.json';
import SemanticMapDetail from './SemanticMapDetail.svelte';
import { createSemanticMapScript, SCRIPT_AGENTS } from './semantic-map-script';
import type { Manifest } from './core/types';

const manifest = manifestJson as Manifest;
const script = createSemanticMapScript();
const route = script.routes['agent-daemon'];

describe('SemanticMapDetail', () => {
  it('renders daemon-owned region metadata and opens its activity evidence', async () => {
    const onOpenFile = vi.fn();
    const view = render(SemanticMapDetail, {
      manifest,
      activities: script.activities,
      selection: { type: 'region', regionId: 'event-stream' },
      onOpenFile,
    });

    expect(
      view.getByRole('heading', {
        name: manifest.regions.find(({ id }) => id === 'event-stream')?.label,
      }),
    ).toBeTruthy();
    const evidence = view.getByRole('button', {
      name: 'packages/intentd/crates/intent-core/src/events/mod.rs',
    });
    await fireEvent.click(evidence);
    expect(onOpenFile).toHaveBeenCalledWith(
      'packages/intentd/crates/intent-core/src/events/mod.rs',
    );
  });

  it('renders agent status, recent activity, and the daemon route', () => {
    const view = render(SemanticMapDetail, {
      manifest,
      activities: script.activities,
      routes: [{ agentId: SCRIPT_AGENTS[0].id, route }],
      selection: { type: 'agent', agentIds: [SCRIPT_AGENTS[0].id] },
      agents: [{ id: SCRIPT_AGENTS[0].id, name: SCRIPT_AGENTS[0].name, status: 'active' }],
    });

    expect(view.getByRole('heading', { name: SCRIPT_AGENTS[0].name })).toBeTruthy();
    expect(view.getByRole('button', { name: route.transitions[0].label })).toBeTruthy();
  });

  it('selects a daemon route transition for crossing details', async () => {
    const onSelectCrossing = vi.fn();
    const view = render(SemanticMapDetail, {
      manifest,
      activities: script.activities,
      route,
      selection: { type: 'route' },
      onSelectCrossing,
    });

    await fireEvent.click(view.getByRole('button', { name: /ACP updates become/ }));
    expect(onSelectCrossing).toHaveBeenCalledWith(0);
  });

  it('shows declared crossing evidence and selects its file', async () => {
    const onSelectFile = vi.fn();
    const onNavigateBack = vi.fn();
    const view = render(SemanticMapDetail, {
      manifest,
      activities: script.activities,
      route,
      selection: { type: 'crossing', transitionIndex: 0 },
      onSelectFile,
      onNavigateBack,
    });

    const transition = route.transitions[0];
    const from = manifest.regions.find(({ id }) => id === transition.from)?.label;
    const to = manifest.regions.find(({ id }) => id === transition.to)?.label;
    expect(view.getByRole('heading', { name: `${from} → ${to}` })).toBeTruthy();
    const evidence = view.getByRole('button', { name: route.transitions[0].evidence[0] });
    await fireEvent.click(evidence);
    expect(onSelectFile).toHaveBeenCalledWith(route.transitions[0].evidence[0]);
    await fireEvent.click(view.getByRole('button', { name: m.ui_navButtons_goBack_tooltip() }));
    expect(onNavigateBack).toHaveBeenCalledOnce();
  });

  it('opens tracked file and diff views from file evidence', async () => {
    const path = route.transitions[0].evidence[0];
    const onOpenFile = vi.fn();
    const onOpenDiff = vi.fn();
    const view = render(SemanticMapDetail, {
      manifest,
      activities: script.activities,
      selection: { type: 'file', path },
      fileChanges: [{ path, additions: 18, deletions: 4 }],
      onOpenFile,
      onOpenDiff,
    });

    expect(view.getByRole('heading', { name: path.slice(path.lastIndexOf('/') + 1) })).toBeTruthy();
    expect(view.getByText(path.slice(0, path.lastIndexOf('/')))).toBeTruthy();
    const buttons = view.getAllByRole('button');
    await fireEvent.click(buttons[0]);
    await fireEvent.click(buttons[1]);
    expect(onOpenFile).toHaveBeenCalledWith(path);
    expect(onOpenDiff).toHaveBeenCalledWith(path);
  });
});
