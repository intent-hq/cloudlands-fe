<script lang="ts">
  import { onMount } from 'svelte';
  import WorkspaceStatusCard from '$lib/components/workspace/WorkspaceStatusCard.svelte';
  import WorkspacePhaseIndicator from '$lib/components/workspace/WorkspacePhaseIndicator.svelte';
  import type {
    WorkspacePhaseInfo,
    WorkspacePhaseStats,
    WorkspacePhase,
  } from '$lib/components/workspace/workspace-phase';
  import { PHASE_META } from '$lib/components/workspace/workspace-phase';

  onMount(() => {
    console.log('[test-workspace-cards] Page mounted successfully');
  });

  const allPhases: WorkspacePhase[] = ['planning', 'building', 'reviewing', 'shipped'];
  const indicatorSizes = [12, 16, 20, 28];

  const phaseFlowDescriptions: Record<WorkspacePhase, string> = {
    planning:
      'First, the Coordinator agent will research and create a Spec. You can edit and iterate on it.',
    building: 'Once approved, the Coordinator will delegate the work and verify it.',
    reviewing: 'Once the work is done, review and ship the changes.',
    shipped: 'All set! No un-merged changes.',
  };

  // ── Interactive click-through card ──
  const interactiveSteps: { phase: WorkspacePhaseInfo; stats: WorkspacePhaseStats }[] = [
    {
      phase: {
        phase: 'planning',
        label: 'Planning',
        subtitle: 'Describe what you want to build',
        isActive: false,
      },
      stats: {
        tasks: { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
        files: { changed: 0, additions: 0, deletions: 0 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
    },
    {
      phase: {
        phase: 'planning',
        label: 'Planning',
        subtitle: 'Coordinator is researching...',
        isActive: true,
      },
      stats: {
        tasks: { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
        files: { changed: 0, additions: 0, deletions: 0 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
    },
    {
      phase: {
        phase: 'planning',
        label: 'Planning',
        subtitle: 'Spec ready for review',
        isActive: false,
      },
      stats: {
        tasks: { total: 6, completed: 0, inProgress: 0, notStarted: 6 },
        files: { changed: 0, additions: 0, deletions: 0 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
    },
    {
      phase: {
        phase: 'building',
        label: 'Building',
        subtitle: '2 tasks being implemented',
        isActive: true,
      },
      stats: {
        tasks: { total: 6, completed: 1, inProgress: 2, notStarted: 3 },
        files: { changed: 3, additions: 85, deletions: 12 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
    },
    {
      phase: {
        phase: 'building',
        label: 'Building',
        subtitle: '1 task being implemented',
        isActive: true,
      },
      stats: {
        tasks: { total: 6, completed: 4, inProgress: 1, notStarted: 1 },
        files: { changed: 8, additions: 320, deletions: 67 },
        commits: { total: 2, unpushed: 2 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
    },
    {
      phase: {
        phase: 'building',
        label: 'Building',
        subtitle: '6 of 6 tasks complete',
        isActive: false,
      },
      stats: {
        tasks: { total: 6, completed: 6, inProgress: 0, notStarted: 0 },
        files: { changed: 14, additions: 480, deletions: 95 },
        commits: { total: 4, unpushed: 4 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
    },
    {
      phase: {
        phase: 'reviewing',
        label: 'Reviewing',
        subtitle: 'Review changes and create a PR',
        isActive: false,
      },
      stats: {
        tasks: { total: 6, completed: 6, inProgress: 0, notStarted: 0 },
        files: { changed: 14, additions: 480, deletions: 95 },
        commits: { total: 4, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
    },
    {
      phase: { phase: 'reviewing', label: 'Reviewing', subtitle: 'PR #27 open', isActive: false },
      stats: {
        tasks: { total: 6, completed: 6, inProgress: 0, notStarted: 0 },
        files: { changed: 14, additions: 480, deletions: 95 },
        commits: { total: 4, unpushed: 0 },
        pr: { hasOpen: true, hasMerged: false, hasClosed: false, number: 27 },
      },
    },
    {
      phase: { phase: 'shipped', label: 'Shipped', subtitle: 'PR #27 merged', isActive: false },
      stats: {
        tasks: { total: 6, completed: 6, inProgress: 0, notStarted: 0 },
        files: { changed: 14, additions: 480, deletions: 95 },
        commits: { total: 4, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: true, hasClosed: false, number: 27 },
      },
    },
  ];
  let interactiveStep = $state(0);
  const currentInteractive = $derived(interactiveSteps[interactiveStep]);
  function nextStep() {
    interactiveStep = (interactiveStep + 1) % interactiveSteps.length;
  }

  type CardData = {
    phase: WorkspacePhaseInfo;
    stats: WorkspacePhaseStats;
    title: string;
    repo: string;
    branch: string;
  };

  const mainCards: CardData[] = [
    {
      phase: {
        phase: 'planning',
        label: 'Planning',
        subtitle: 'Spec ready for review',
        isActive: false,
      },
      stats: {
        tasks: { total: 6, completed: 0, inProgress: 0, notStarted: 6 },
        files: { changed: 0, additions: 0, deletions: 0 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
      title: 'Add dark mode support',
      repo: 'acme/frontend',
      branch: 'feat/dark-mode',
    },
    {
      phase: {
        phase: 'building',
        label: 'Building',
        subtitle: '2 tasks being implemented',
        isActive: true,
      },
      stats: {
        tasks: { total: 6, completed: 2, inProgress: 2, notStarted: 2 },
        files: { changed: 3, additions: 120, deletions: 45 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
      title: 'Refactor auth middleware',
      repo: 'acme/backend',
      branch: 'refactor/auth',
    },
    {
      phase: {
        phase: 'reviewing',
        label: 'Reviewing',
        subtitle: 'Review changes and create a PR',
        isActive: false,
      },
      stats: {
        tasks: { total: 6, completed: 6, inProgress: 0, notStarted: 0 },
        files: { changed: 20, additions: 450, deletions: 120 },
        commits: { total: 3, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
      title: 'Migrate to new API',
      repo: 'acme/api',
      branch: 'migrate/v2',
    },
    {
      phase: { phase: 'shipped', label: 'Shipped', subtitle: 'PR #13 merged', isActive: false },
      stats: {
        tasks: { total: 6, completed: 6, inProgress: 0, notStarted: 0 },
        files: { changed: 3, additions: 89, deletions: 23 },
        commits: { total: 3, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: true, hasClosed: false, number: 13, url: '#' },
      },
      title: 'Fix login redirect bug',
      repo: 'acme/frontend',
      branch: 'fix/login-redirect',
    },
  ];

  type EdgeData = {
    phase: WorkspacePhaseInfo;
    stats: WorkspacePhaseStats;
    title: string;
    label: string;
  };

  const edgeCases: EdgeData[] = [
    {
      label: 'Empty workspace',
      phase: {
        phase: 'planning',
        label: 'Planning',
        subtitle: 'Describe what you want to build',
        isActive: false,
      },
      stats: {
        tasks: { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
        files: { changed: 0, additions: 0, deletions: 0 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
      title: 'Untitled workspace',
    },
    {
      label: 'Active agent (pulsing)',
      phase: {
        phase: 'planning',
        label: 'Planning',
        subtitle: 'Coordinator is researching...',
        isActive: true,
      },
      stats: {
        tasks: { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
        files: { changed: 0, additions: 0, deletions: 0 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false, hasClosed: false },
      },
      title: 'New workspace (agent active)',
    },
    {
      label: 'With open PR',
      phase: { phase: 'reviewing', label: 'Reviewing', subtitle: 'PR #42 open', isActive: false },
      stats: {
        tasks: { total: 8, completed: 8, inProgress: 0, notStarted: 0 },
        files: { changed: 12, additions: 340, deletions: 89 },
        commits: { total: 5, unpushed: 0 },
        pr: { hasOpen: true, hasMerged: false, hasClosed: false, number: 42 },
      },
      title: 'Upgrade dependencies',
    },
  ];

  function handleAction(action: string) {
    console.log('Action:', action);
  }
</script>

<div class="p-8 max-w-5xl mx-auto">
  <h1 class="text-2xl font-bold mb-1">Workspace Status Cards</h1>
  <p class="text-muted-foreground mb-10 text-sm">
    Visual sandbox — all variants, phases, and edge cases
  </p>

  <!-- 0. Interactive click-through -->
  <section class="mb-12">
    <h2 class="text-lg font-semibold mb-4">Interactive — click to advance</h2>
    <div class="grid grid-cols-[1fr_320px] gap-6 items-start">
      <button type="button" onclick={nextStep} class="cursor-pointer text-left w-full">
        <WorkspaceStatusCard
          phase={currentInteractive.phase}
          stats={currentInteractive.stats}
          title="Add dark mode support"
          repoName="acme/frontend"
          branch="feat/dark-mode"
          onAction={handleAction}
        />
      </button>
      <!-- Step info -->
      <div class="flex flex-col gap-3">
        <div class="text-xs text-muted-foreground font-medium">
          Step {interactiveStep + 1} / {interactiveSteps.length}
        </div>
        <!-- Phase timeline -->
        {#each allPhases as p, i}
          {@const isCurrentPhase = p === currentInteractive.phase.phase}
          {@const isPast = allPhases.indexOf(p) < allPhases.indexOf(currentInteractive.phase.phase)}
          <div class="flex items-center gap-2 {i < 3 ? '' : ''}">
            <WorkspacePhaseIndicator
              phase={p}
              size={14}
              class={!isCurrentPhase && !isPast ? 'opacity-30' : ''}
            />
            <span
              class="text-xs {isCurrentPhase
                ? 'font-semibold text-foreground'
                : isPast
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/40'}">{PHASE_META[p].label}</span
            >
            {#if isCurrentPhase}
              <span class="text-[10px] text-muted-foreground ml-auto"
                >{currentInteractive.phase.subtitle}</span
              >
            {/if}
          </div>
        {/each}
        <button
          type="button"
          class="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
          onclick={() => (interactiveStep = 0)}>↺ Reset</button
        >
      </div>
    </div>
  </section>

  <!-- 1. Phase Indicators at all sizes -->
  <section class="mb-12">
    <h2 class="text-lg font-semibold mb-4">Phase Indicators</h2>
    <div class="bg-card rounded-xl border border-border p-6">
      <div class="grid grid-cols-5 gap-y-4 items-center">
        <div class="text-xs text-muted-foreground font-medium">Size</div>
        {#each allPhases as p}
          <div class="text-xs text-muted-foreground font-medium text-center">
            {PHASE_META[p].label}
          </div>
        {/each}
        {#each indicatorSizes as sz}
          <div class="text-xs text-muted-foreground tabular-nums">{sz}px</div>
          {#each allPhases as p}
            <div class="flex justify-center">
              <WorkspacePhaseIndicator phase={p} size={sz} />
            </div>
          {/each}
        {/each}
      </div>
    </div>
  </section>

  <!-- 2. Phase Flow Diagram -->
  <section class="mb-12">
    <h2 class="text-lg font-semibold mb-4">Phase Flow</h2>
    <div class="bg-card rounded-xl border border-border p-6 max-w-md">
      {#each allPhases as p, i}
        <div class="flex items-start gap-3 {i < 3 ? 'mb-1' : ''}">
          <div class="flex flex-col items-center">
            <WorkspacePhaseIndicator phase={p} size={20} />
            {#if i < 3}
              <div class="w-px h-10 bg-border"></div>
            {/if}
          </div>
          <div class="pt-0.5">
            <div class="text-sm font-semibold">{PHASE_META[p].label}</div>
            <div class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {phaseFlowDescriptions[p]}
            </div>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- 3. Full Cards — one per phase -->
  <section class="mb-12">
    <h2 class="text-lg font-semibold mb-4">Card Variant (home page / overview)</h2>
    <div class="grid grid-cols-2 gap-4">
      {#each mainCards as item}
        <WorkspaceStatusCard
          phase={item.phase}
          stats={item.stats}
          title={item.title}
          repoName={item.repo}
          branch={item.branch}
          onAction={handleAction}
        />
      {/each}
    </div>
  </section>

  <!-- 4. Edge Cases -->
  <section class="mb-12">
    <h2 class="text-lg font-semibold mb-4">Edge Cases</h2>
    <div class="grid grid-cols-3 gap-4">
      {#each edgeCases as item}
        <div>
          <div class="text-xs text-muted-foreground mb-1.5 font-medium">{item.label}</div>
          <WorkspaceStatusCard
            phase={item.phase}
            stats={item.stats}
            title={item.title}
            onAction={handleAction}
          />
        </div>
      {/each}
    </div>
  </section>

  <!-- 5. Header Variant (sidebar width) -->
  <section class="mb-12">
    <h2 class="text-lg font-semibold mb-4">Header Variant (sidebar ~320px)</h2>
    <div
      class="bg-card rounded-xl border border-border p-3 flex flex-col gap-3"
      style="width: 320px;"
    >
      {#each mainCards as item}
        <WorkspaceStatusCard phase={item.phase} stats={item.stats} variant="header" />
      {/each}
    </div>
  </section>

  <!-- 6. Row Variant (narrow list) -->
  <section class="mb-12">
    <h2 class="text-lg font-semibold mb-4">Row Variant (sidebar list ~280px)</h2>
    <div
      class="bg-card rounded-xl border border-border p-2 flex flex-col gap-0.5"
      style="width: 280px;"
    >
      {#each [...mainCards, ...edgeCases] as item}
        <WorkspaceStatusCard
          phase={item.phase}
          stats={item.stats}
          variant="row"
          onClick={() => console.log('clicked', item.title)}
          class="px-2 py-1 rounded-md"
        />
      {/each}
    </div>
  </section>

  <!-- 7. Home Page Preview -->
  <section class="mb-12">
    <h2 class="text-lg font-semibold mb-4">Home Page Preview (2-column grid)</h2>
    <div class="bg-sidebar border border-border rounded-2xl p-6">
      <div class="text-sm font-semibold mb-3 text-muted-foreground">Your Workspaces</div>
      <div class="grid grid-cols-2 gap-4">
        {#each [...mainCards, ...edgeCases.slice(1, 3)] as item}
          <WorkspaceStatusCard
            phase={item.phase}
            stats={item.stats}
            title={item.title}
            repoName={'repo' in item ? item.repo : undefined}
            branch={'branch' in item ? item.branch : undefined}
            onClick={() => console.log('navigate to', item.title)}
            onAction={handleAction}
          />
        {/each}
      </div>
    </div>
  </section>
</div>
