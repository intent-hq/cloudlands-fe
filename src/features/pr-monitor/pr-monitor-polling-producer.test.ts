/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { PrMonitorSession } from '$shared/types/pr-monitor';
import producer from '../../test/fixtures/qualified-monitor-polling-producer.json';
import { listPrMonitors } from './pr-monitor-service';
import {
  prMonitorReducer,
  prMonitorsUpdated,
} from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
import { selectReviewMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
import { buildWorkspacePRPresentationModel } from '$lib/components/workspace/sidebar/workspace-pr-presentation';
import SidebarPrList from '$lib/components/workspace/sidebar/SidebarPrList.svelte';

// Exact captured output of backend38c1aa82; empty lifecycle events prove withholding only.
describe('final GitLab polling producer', () => {
  for (const fixture of producer.fixtures) {
    it(`${fixture.terminal}: preserves actual pending/completed rows through service, state and presentation`, async () => {
      for (const stage of ['pendingRows', 'completedRows'] as const) {
        const raw = fixture[stage];
        const workspaceId = raw[0].workspaceId;
        const origin = { backendId: 'producer-host', sessionId: 'producer-session', workspaceId };
        const request = vi.fn().mockResolvedValue({ monitors: raw });
        const session: PrMonitorSession = {
          origin,
          request,
          support: 'consumer-pending',
          release: async () => {},
          onRetired: () => () => {},
          onNotification: () => () => {},
        };
        const rows = await listPrMonitors(workspaceId, session);
        expect(request).toHaveBeenCalledExactlyOnceWith('prMonitor.list', { workspaceId });
        const state = prMonitorReducer(undefined, prMonitorsUpdated(workspaceId, rows));
        const selected = selectReviewMonitors.select(
          { prMonitor: state } as Parameters<typeof selectReviewMonitors.select>[0],
          workspaceId,
        );
        expect(selected).toEqual(raw.map((row) => ({ ...row, origin })));
        expect(selected[0].lastSnapshot?.hasConflicts).toBeNull();
        expect(selected[0].lastSnapshot?.isBehind).toBeNull();
        const presentation = buildWorkspacePRPresentationModel({
          workspacePRs: [],
          activePR: null,
          monitors: selected,
          workspaceRepo: 'group/project',
          buildPrUrl: () => {
            throw Error('Canonical URL required');
          },
          getDisplayTitle: (pr) => pr.title,
        });
        expect(presentation).toHaveLength(1);
        expect(presentation[0].url).toBe(raw[0].url);
        expect(presentation[0].resource).toEqual(raw[0].resource);
        expect(presentation[0].status).toBe(stage === 'pendingRows' ? 'open' : fixture.terminal);
        if (stage === 'pendingRows') {
          const other = structuredClone(presentation[0]);
          other.identity = 'other-instance';
          if (!other.resource) throw Error('Expected qualified resource');
          other.resource.repository.instanceBaseUrl = 'https://second.example/install';
          other.url = '';
          const component = render(SidebarPrList, {
            rows: [presentation[0], other],
            interactive: false,
            onSelect: () => {},
          });
          const labels = [...component.container.querySelectorAll('[data-sidebar-pr-link]')].map(
            (node) => node.getAttribute('title'),
          );
          expect(new Set(labels).size).toBe(2);
          expect(labels[0]).toContain('gitlab.test/forge');
          expect(labels[1]).toContain('second.example/install');
          component.unmount();
        }
      }
      expect(fixture.sharedLifecycleEvents).toEqual([]);
    });
  }
});
