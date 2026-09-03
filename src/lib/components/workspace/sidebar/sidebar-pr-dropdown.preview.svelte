<script lang="ts" module>
  import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
  import type { PullRequestInfo } from '$shared/types';
  import { PullRequestStatus } from '$shared/types';
  import { constructPrUrl } from './sidebar-changes-utils';
  import {
    buildWorkspacePRPresentationModel,
    type WorkspacePRPresentationRow,
  } from './workspace-pr-presentation';

  const WORKSPACE_REPO = 'intent-hq/cloudlands-fe';

  interface SidebarPrDropdownScenario {
    key: string;
    label: string;
    expected: string;
    rows: WorkspacePRPresentationRow[];
  }

  export interface SidebarPrDropdownPreviewProps {
    scenarios: SidebarPrDropdownScenario[];
    /** Render a single scenario inside a launcher-like footer with the live dropdown. */
    live?: boolean;
  }

  function pr(number: number, overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
    return {
      id: `preview-pr-${number}`,
      number,
      url: `https://github.com/${WORKSPACE_REPO}/pull/${number}`,
      title: `Preview pull request ${number}`,
      status: PullRequestStatus.Open,
      ...PREVIEW_FIXTURE_TIMESTAMPS,
      ...overrides,
    };
  }

  function monitor(
    repo: string,
    prNumber: number,
    overrides: Partial<PrMonitorRow> = {},
  ): PrMonitorRow {
    return {
      monitorId: `preview-monitor-${repo}-${prNumber}`,
      workspaceId: 'preview-workspace',
      agentId: 'agent-preview',
      repo,
      prNumber,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: PREVIEW_FIXTURE_TIMESTAMPS.createdAt,
      updatedAt: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
      ...overrides,
    };
  }

  function rows(
    input: {
      pullRequests?: PullRequestInfo[];
      activePR?: PullRequestInfo | null;
      monitors?: PrMonitorRow[];
      repo?: string | undefined;
    } = {},
  ): WorkspacePRPresentationRow[] {
    const repo = 'repo' in input ? input.repo : WORKSPACE_REPO;
    const [owner, name] = repo?.split('/') ?? [];
    return buildWorkspacePRPresentationModel({
      workspacePRs: input.pullRequests,
      activePR: input.activePR,
      monitors: input.monitors ?? [],
      workspaceRepo: repo,
      buildPrUrl: (prNumber, fallbackUrl) => constructPrUrl(prNumber, owner, name, fallbackUrl),
      getDisplayTitle: (item) => item.title,
    });
  }

  function scenario(
    key: string,
    label: string,
    expected: string,
    prRows: WorkspacePRPresentationRow[],
  ): SidebarPrDropdownScenario {
    return { key, label, expected, rows: prRows };
  }

  const LONG_TITLE =
    'feat(sidebar): replace the single pull request icon with a dropdown that lists every related pull request across repositories';

  export const scenarios: SidebarPrDropdownScenario[] = [
    scenario(
      'single-open',
      'Single open PR',
      'Green glyph, no count badge, one row.',
      rows({
        pullRequests: [pr(101)],
      }),
    ),
    scenario(
      'single-draft',
      'Single draft PR',
      'Muted glyph; draft overrides open.',
      rows({
        pullRequests: [pr(102, { isDraft: true })],
      }),
    ),
    scenario(
      'single-merged',
      'Single merged PR',
      'Purple merge glyph.',
      rows({
        pullRequests: [pr(103, { status: PullRequestStatus.Merged })],
      }),
    ),
    scenario(
      'single-closed',
      'Single closed PR',
      'Red glyph with closed state.',
      rows({
        pullRequests: [pr(104, { status: PullRequestStatus.Closed })],
      }),
    ),
    scenario(
      'mixed-order',
      'Mixed statuses (ordering)',
      'Badge shows 4; rows sort open → draft → merged → closed and the lead glyph is green.',
      rows({
        pullRequests: [
          pr(110, { status: PullRequestStatus.Closed }),
          pr(111, { status: PullRequestStatus.Merged }),
          pr(112, { isDraft: true }),
          pr(113),
        ],
      }),
    ),
    scenario(
      'active-fallback',
      'activePullRequest fallback',
      'No pullRequests pool; the active PR alone renders.',
      rows({ activePR: pr(120, { ciStatus: { total: 4, passed: 3, failed: 0, pending: 1 } }) }),
    ),
    scenario(
      'cross-repo',
      'Cross-repo PR in pool',
      'Second row shows the short repo context (intentd) on its summary line.',
      rows({
        pullRequests: [
          pr(130),
          pr(1330, {
            url: 'https://github.com/intent-hq/intentd/pull/1330',
            title: 'Merge monitor PRs into the workspace pool',
          }),
        ],
      }),
    ),
    scenario(
      'monitor-only',
      'Monitor-only PR (with snapshot)',
      'Row comes from an agent PR monitor; summary carries the snapshot state line.',
      rows({
        monitors: [
          monitor(WORKSPACE_REPO, 140, {
            title: 'Monitored by an agent',
            lastSnapshot: {
              state: 'open',
              isDraft: false,
              hasConflicts: false,
              isBehind: true,
              mergeable: true,
              checks: {
                total: 6,
                passed: 4,
                failed: 1,
                pending: 1,
                failingRequired: 1,
                pendingRequired: 0,
                requiredKnown: true,
              },
              approvals: { decision: 'CHANGES_REQUESTED', have: 0, needed: 1, changesRequested: 1 },
              threads: { unresolved: 2, resolutionRequired: true },
              rulesKnown: true,
            },
          }),
        ],
      }),
    ),
    scenario(
      'monitor-no-title',
      'Monitor without title or snapshot',
      'Falls back to repo#number as the title; no detail line beyond state.',
      rows({ monitors: [monitor('intent-hq/intentd', 141)] }),
    ),
    scenario(
      'dedup',
      'Branch PR + monitor of same PR',
      'Deduplicated to one row; badge absent.',
      rows({
        pullRequests: [pr(150)],
        monitors: [monitor(WORKSPACE_REPO, 150, { title: 'Duplicate title from monitor' })],
      }),
    ),
    scenario(
      'dedup-case',
      'Case-insensitive repo dedup',
      'Intent-HQ/Cloudlands-FE#151 and the monitor row collapse into one entry.',
      rows({
        pullRequests: [pr(151, { url: 'https://github.com/Intent-HQ/Cloudlands-FE/pull/151' })],
        monitors: [monitor(WORKSPACE_REPO, 151)],
      }),
    ),
    scenario(
      'missing-title',
      'Missing title',
      'Generic "Pull request" label with the number.',
      rows({
        pullRequests: [pr(160, { title: '' })],
      }),
    ),
    scenario(
      'long-title',
      'Very long title',
      'Title truncates with an ellipsis; number stays visible.',
      rows({
        pullRequests: [pr(161, { title: LONG_TITLE })],
      }),
    ),
    scenario(
      'no-url',
      'No repo and no URL',
      'Row is disabled (dimmed) because no URL can be constructed.',
      rows({ repo: undefined, pullRequests: [pr(162, { url: '' })] }),
    ),
    scenario(
      'no-workspace-repo',
      'Workspace without repo metadata',
      'Rows stay unqualified; URLs come from each entry.',
      rows({
        repo: undefined,
        pullRequests: [pr(163), pr(164, { status: PullRequestStatus.Merged })],
      }),
    ),
    scenario(
      'zero-number',
      'Number 0 (malformed)',
      'Renders #0 without crashing.',
      rows({
        activePR: pr(0, { title: 'Malformed pull request' }),
      }),
    ),
    scenario(
      'many',
      'Many PRs (two-digit badge)',
      'Badge widens to fit 12; list scrolls inside the menu.',
      rows({
        pullRequests: Array.from({ length: 12 }, (_, index) =>
          pr(200 + index, {
            status:
              index % 4 === 3
                ? PullRequestStatus.Closed
                : index % 4 === 2
                  ? PullRequestStatus.Merged
                  : PullRequestStatus.Open,
            isDraft: index % 4 === 1,
          }),
        ),
      }),
    ),
    scenario('empty', 'No PRs', 'Trigger is not rendered at all.', rows()),
  ];

  export const preview = definePreview<SidebarPrDropdownPreviewProps>({
    id: 'sidebar-pr-dropdown',
    title: 'Sidebar PR dropdown',
    defaultState: 'matrix',
    states: {
      matrix: { props: { scenarios } },
      live: {
        props: { scenarios: scenarios.filter((item) => item.key === 'mixed-order'), live: true },
      },
      'live-many': {
        props: { scenarios: scenarios.filter((item) => item.key === 'many'), live: true },
      },
    },
  });
</script>

<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
  import SidebarPrDropdown from './SidebarPrDropdown.svelte';
  import SidebarPrList from './SidebarPrList.svelte';

  let { scenarios: items, live = false }: SidebarPrDropdownPreviewProps = $props();
</script>

<section class="grid gap-5" data-sidebar-pr-dropdown-preview>
  {#if live}
    {#each items as item (item.key)}
      <article class="grid gap-2" data-preview-scenario={item.key}>
        <div>
          <h3 class="text-sm font-semibold">{item.label}</h3>
          <p class="text-xs leading-5 text-muted-foreground">{item.expected}</p>
        </div>
        <div
          class="flex h-[360px] w-[320px] flex-col justify-end rounded-lg border border-border bg-sidebar p-2"
        >
          {@render launcher(item.rows)}
        </div>
      </article>
    {/each}
  {:else}
    <div class="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
      {#each items as item (item.key)}
        <article class="grid min-w-0 gap-2" data-preview-scenario={item.key}>
          <div>
            <h3 class="text-sm font-semibold">{item.label}</h3>
            <p class="text-xs leading-5 text-muted-foreground">{item.expected}</p>
          </div>
          <div class="grid gap-2 rounded-lg border border-border bg-sidebar p-2">
            {@render launcher(item.rows)}
            {#if item.rows.length > 0}
              <div
                class="max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-sm"
              >
                <SidebarPrList rows={item.rows} onSelect={() => {}} class="w-full" />
              </div>
            {:else}
              <p class="px-2 py-1 text-xs text-muted-foreground" data-preview-empty>
                No trigger, no menu.
              </p>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

{#snippet launcher(prRows: WorkspacePRPresentationRow[])}
  <!-- Stand-in for the compact Changes launcher card: icon, label, then the dropdown on the right. -->
  <div
    class="flex h-9 items-center gap-2 rounded-md bg-muted/40 px-2 text-sm text-foreground"
    data-preview-launcher
  >
    <Fa icon={faCodePullRequest} class="size-3.5! text-muted-foreground" />
    <span class="flex-1">Changes</span>
    <SidebarPrDropdown rows={prRows} workspaceId="preview-workspace" class="ml-auto" />
  </div>
{/snippet}
