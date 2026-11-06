<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store } from '$store/renderer/store';
  import {
    beginWorkspaceCreateProgress,
    clearWorkspaceCreateProgress,
    workspaceCreateProgressReceived,
  } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';

  const groups = [
    {
      title: 'Cloning a repository',
      entries: [
        { phase: 'starting', percent: 0 },
        { phase: 'cache', percent: 5 },
        { phase: 'counting', percent: 10 },
        { phase: 'compressing', percent: 15 },
        { phase: 'receiving', percent: 45 },
        { phase: 'resolving', percent: 65 },
        { phase: 'checkout', percent: 75 },
      ],
    },
    {
      title: 'Other setup stages',
      entries: [
        { phase: 'submodules', percent: 80 },
        { phase: 'submodules', percent: 85, message: 'Cloning submodules (2/3)' },
        { phase: 'cow-copy', percent: 90 },
        { phase: 'worktree', percent: 90 },
        { phase: 'finalizing', percent: 95 },
        { phase: 'complete', percent: 100 },
      ],
    },
  ];
  const frames = [...groups.flatMap((group) => group.entries), { phase: 'unknown', percent: 37 }];
  const progressId = (index: number) => `button-state-reference-${index}`;

  interface Props {
    narrow?: boolean;
    animation?: boolean;
  }

  function setupProgress() {
    frames.forEach((frame, index) => {
      store.dispatch(beginWorkspaceCreateProgress(progressId(index)));
      store.dispatch(workspaceCreateProgressReceived(progressId(index), frame));
    });
    return () =>
      frames.forEach((_, index) => store.dispatch(clearWorkspaceCreateProgress(progressId(index))));
  }

  export const preview = definePreview<Props>({
    id: 'workspace-submit',
    title: 'New workspace button',
    defaultState: 'overview',
    states: {
      overview: { props: {}, setup: setupProgress },
      narrow: { props: { narrow: true }, setup: setupProgress },
      animation: { props: { animation: true }, setup: setupProgress },
    },
  });
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import WorkspaceCreateButton from './WorkspaceCreateButton.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import CreateButtonProgress from './CreateButtonProgress.svelte';

  let { narrow = false, animation = false }: Props = $props();
  let playing = $state(true);
  let animationStep = $state(0);

  const fallbackLabels = [
    m.workspace_compactInitializer_stagePreparing_label(),
    m.workspace_compactInitializer_stageGitBranch_label(),
    m.workspace_compactInitializer_stageEnvironment_label(),
    m.workspace_compactInitializer_stageAlmostReady_label(),
  ];
  const animationLabels = [
    m.workspace_compactInitializer_stagePreparing_label(),
    m.workspace_compactInitializer_progressCache_label(),
    m.workspace_compactInitializer_progressReceiving_label(),
    m.workspace_compactInitializer_progressSubmodulesCounted_label({ current: '2', total: '3' }),
    m.workspace_compactInitializer_stageEnvironment_label(),
    m.workspace_compactInitializer_progressFinalizing_label(),
    m.workspace_compactInitializer_stageAlmostReady_label(),
  ];

  function advance() {
    animationStep = (animationStep + 1) % animationLabels.length;
  }

  $effect(() => {
    if (!animation || !playing) return;
    const timer = setInterval(advance, 1500);
    return () => clearInterval(timer);
  });
</script>

{#snippet button(label: string, creating = true, invalid = false, busy = false)}
  <WorkspaceCreateButton {creating} {label} valid={!invalid} disabled={busy} />
{/snippet}

<div class="bg-background p-6 text-foreground" data-button-state-gallery>
  <header class="mb-6">
    <h1 class="type-body font-medium">New workspace button</h1>
    <p class="mt-1 type-body text-muted-foreground">
      Different creation paths use different stages.
    </p>
  </header>
  {#if animation}
    <div class="grid max-w-80 gap-5" data-motion-button-demo>
      <WorkspaceCreateButton
        creating
        label={animationLabels[animationStep]}
        data-testid="animated-create-button"
      />
      <div class="w-40">
        <WorkspaceCreateButton
          creating
          label={animationLabels[animationStep]}
          data-testid="animated-narrow-button"
        />
      </div>
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="compact" onclick={() => (playing = !playing)}
          >{playing ? 'Pause' : 'Play'}</Button
        >
        <Button
          variant="ghost"
          size="compact"
          onclick={() => {
            playing = false;
            advance();
          }}>Next step</Button
        >
      </div>
    </div>
  {:else if narrow}
    <div class="flex flex-wrap items-start gap-8" data-narrow-button-gallery>
      {#each [160, 200, 240, 320] as width}
        <section
          class="grid min-w-0 grid-cols-1 gap-3"
          style:width={`${width}px`}
          data-button-width={width}
        >
          <h2 class="type-body font-medium">{width}px</h2>
          <WorkspaceCreateButton />
          <WorkspaceCreateButton
            creating
            label={m.workspace_compactInitializer_progressCache_label()}
          />
          <WorkspaceCreateButton
            creating
            label={m.workspace_compactInitializer_progressCache_label({}, { locale: 'de' })}
          />
          <CreateButtonProgress
            class="w-full"
            progressId={progressId(8)}
            fallbackLabel={fallbackLabels[0]}
          >
            {#snippet children(label)}{@render button(label)}{/snippet}
          </CreateButtonProgress>
          <WorkspaceCreateButton
            creating
            label={m.workspace_compactInitializer_progressSubmodulesCounted_label({
              current: '123',
              total: '4567',
            })}
          />
        </section>
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-8 min-[900px]:grid-cols-3">
      <div class="min-w-0 space-y-6">
        <section class="grid gap-3">
          <h2 class="type-body font-medium">Ready</h2>
          {@render button(m.workspace_compactInitializer_createWorkspace_label(), false)}
          <p class="type-body text-muted-foreground">Invalid form · shortcut hidden</p>
          {@render button(m.workspace_compactInitializer_createWorkspace_label(), false, true)}
          <p class="type-body text-muted-foreground">Busy · shortcut shown</p>
          {@render button(
            m.workspace_compactInitializer_createWorkspace_label(),
            false,
            false,
            true,
          )}
        </section>
        <section class="grid gap-3">
          <h2 class="type-body font-medium">Updating an existing repository</h2>
          {@render button(m.workspace_compactInitializer_pullingLatest_label())}
        </section>
        <section class="grid gap-3">
          <h2 class="type-body font-medium">Before live progress arrives</h2>
          {#each fallbackLabels as label}
            {@render button(label)}
          {/each}
          <p class="type-body text-muted-foreground">
            These labels advance on a timer before live progress arrives.
          </p>
        </section>
      </div>
      {#each groups as group, groupIndex}
        <div class="min-w-0 space-y-6">
          <section class="grid gap-3">
            <h2 class="type-body font-medium">{group.title}</h2>
            {#each group.entries as _entry, index}
              <CreateButtonProgress
                class="w-full"
                progressId={progressId(groupIndex === 0 ? index : groups[0].entries.length + index)}
                fallbackLabel={fallbackLabels[0]}
              >
                {#snippet children(label)}{@render button(label)}{/snippet}
              </CreateButtonProgress>
            {/each}
          </section>
          {#if groupIndex === 1}
            <section class="grid gap-3">
              <h2 class="type-body font-medium">Unrecognized progress phase</h2>
              <CreateButtonProgress
                class="w-full"
                progressId={progressId(frames.length - 1)}
                fallbackLabel={fallbackLabels[0]}
              >
                {#snippet children(label)}{@render button(label)}{/snippet}
              </CreateButtonProgress>
              <p class="type-body text-muted-foreground">Uses the general preparing label.</p>
            </section>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
