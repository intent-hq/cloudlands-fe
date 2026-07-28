<script lang="ts">
  /**
   * WorkspaceSetupCard — A live status card showing workspace creation progress.
   *
   * Shows 4 steps: repo clone, branch, setup script, agent start.
   * Each step transitions through pending → active → done states.
   * Used both during onboarding (replacing the form) and at the top of the chat panel.
   *
   * Underlined elements are interactive:
   * - Repo name → opens GitHub URL (if available)
   * - Worktree path → OpenComboButton dropdown (open in Finder/editor/terminal)
   * - Branch name → copies to clipboard
   * - "this terminal" → focuses the setup terminal
   * - Specialist name → rich tooltip with description, prompt preview, settings link
   */
  import {
  slide,
  blur,
} from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
  faFolderOpen,
  faCodeBranch,
  faTerminal,
  faRobot,
  faCopy,
} from '@fortawesome/free-solid-svg-icons';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import ShimmerOverlay from '$lib/components/ui/ShimmerOverlay.svelte';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { getSpecialistById } from '$lib/constants/specialists';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';

  type StepStatus = 'pending' | 'active' | 'done';

  interface Props {
    /** Display name of the repository (e.g. "wattenberger-2023") */
    repoName: string;
    /** GitHub URL for the repo (if available) */
    repoUrl?: string;
    /** Original source repo path (before worktree) */
    repoPath?: string;
    /** Where the worktree/clone was created */
    worktreePath?: string;
    /** Branch name for the workspace */
    branch?: string;
    /** Base ref the branch was created from (e.g. "origin/main") */
    baseRef?: string;
    /** Detected project type label (e.g. "Node.js (pnpm)") */
    projectType?: string;
    /** Whether a setup script is running or was run. undefined = no setup script. */
    setupScriptStatus?: StepStatus;
    /** The setup script content (for tooltip preview) */
    setupScriptContent?: string;
    /** Callback to focus the setup terminal */
    onFocusSetupTerminal?: () => void;
    /** Name of the specialist/agent (e.g. "Coordinator") */
    specialistName?: string;
    /** The specialist ID for tooltip/settings linking */
    specialistId?: string;
    /** Whether the user provided an initial prompt */
    hasPrompt?: boolean;
    /** Overall creation phase */
    repoStatus?: StepStatus;
    branchStatus?: StepStatus;
    agentStatus?: StepStatus;
    /** If true, the workspace works directly on the branch without an isolated checkout (worktree or CoW clone) */
    skipIsolation?: boolean;
  }

  let {
    repoName,
    repoPath,
    worktreePath,
    branch,
    baseRef = 'origin/main',
    projectType,
    setupScriptStatus,
    setupScriptContent,
    onFocusSetupTerminal,
    specialistName,
    specialistId,
    hasPrompt = true,
    repoStatus = 'pending',
    branchStatus = 'pending',
    agentStatus = 'pending',
    skipIsolation = false,
  }: Props = $props();

  /** For skipIsolation mode, strip the remote prefix (e.g. "origin/main" → "main") */
  const displayBranch = $derived(baseRef.replace(/^[^/]+\//, ''));

  const specialist = $derived(specialistId ? getSpecialistById(specialistId) : undefined);
  /** Use the specialist's canonical name when available, fall back to the passed-in prop */
  const displaySpecialistName = $derived(specialist?.name || specialistName);

  const steps = $derived.by(() => {
    const all: StepStatus[] = [repoStatus, branchStatus];
    if (setupScriptStatus) all.push(setupScriptStatus);
    all.push(agentStatus);
    return all;
  });

  const totalSteps = $derived(steps.length);
  const completedSteps = $derived(steps.filter((s) => s === 'done').length);
  const currentStep = $derived(Math.min(completedSteps + 1, totalSteps));
  const allDone = $derived(completedSteps === totalSteps);
  const title = $derived(
    allDone ? m.onboarding_setupCard_ready_title() : m.onboarding_setupCard_settingUp_title(),
  );

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(m.onboarding_setupCard_copied_label({ label }));
  }

  function shortenPath(p: string): string {
    return p.replace(/^\/Users\/[^/]+/, '~');
  }

  function openSpecialistSettings() {
    if (specialistId) {
      navigateToSettings({ specialist: specialistId, hash: 'specialists' });
    }
  }
</script>

<div class="w-full overflow-hidden transition-all duration-500">
  <!-- Header -->
  <div class="px-4 pt-3 pb-2 flex items-baseline gap-2.5">
    <div class="inline-grid *:[grid-area:1/1]">
      {#key allDone}
        <h3
          class="text-lg font-semibold tracking-[-0.016em] transition-colors duration-500"
          in:blur={{ duration: 400, delay: 200, amount: 3, easing: cubicOut }}
          out:blur={{ duration: 300, amount: 3, easing: cubicOut }}
        >
          {#if allDone}
            <span class="inline-flex items-center gap-1.5">
              {title}
            </span>
          {:else}
            {title}
          {/if}
        </h3>
      {/key}
    </div>
    {#if !allDone}
      <span class="text-sm font-mono text-muted-foreground tabular-nums">
        <span class="inline-grid *:[grid-area:1/1]">
          {#key currentStep}
            <span
              class="inline-block col-span-1 row-span-1"
              in:slide={{ axis: 'y', duration: 300 }}
            >
              {currentStep}
            </span>
          {/key}
        </span>/{totalSteps}
      </span>
    {/if}
  </div>

  <!-- Steps -->
  <div class="px-4 pb-4 space-y-0.5">
    {#snippet stepRow(
      status: StepStatus,
      icon: typeof faFolderOpen,
      iconClass: string,
      activeContent: import('svelte').Snippet,
      doneContent: import('svelte').Snippet,
    )}
      <div
        class="flex items-start gap-2.5 text-base leading-relaxed py-0.75 px-2 -mx-1 rounded-md relative overflow-hidden"
        transition:slide={{ duration: 300, easing: cubicOut }}
      >
        {#if status === 'active'}
          <div class="absolute inset-0 left-5">
            <ShimmerOverlay />
          </div>
        {/if}
        <span class="mt-1 shrink-0 w-4 opacity-30 text-center relative z-10">
          <Fa {icon} size={14} class={iconClass} />
        </span>
        <span class="text-muted-foreground font-normal leading-snug relative z-10">
          {#if status === 'active'}
            <div
              in:slide={{ axis: 'y', duration: 200, easing: cubicOut }}
              out:slide={{ axis: 'y', duration: 200, easing: cubicOut }}
            >
              {@render activeContent()}
            </div>
          {:else}
            <div
              in:slide={{ axis: 'y', duration: 200, easing: cubicOut }}
              out:slide={{ axis: 'y', duration: 200, easing: cubicOut }}
            >
              {@render doneContent()}
            </div>
          {/if}
        </span>
      </div>
    {/snippet}

    <!-- Step 1: Repository -->
    {#if repoStatus !== 'pending'}
      {@render stepRow(
        repoStatus,
        faFolderOpen,
        '-ml-px transform scale-[0.98]',
        repoActive,
        repoDone,
      )}
    {/if}
    {#snippet repoNameCopyable()}
      {#if repoPath}
        {@render copyableRef(repoName, m.onboarding_setupCard_originalFolder_label(), repoPath)}
      {:else}
        {repoName}
      {/if}
    {/snippet}
    {#snippet repoActive()}
      {#if skipIsolation}
        {m.onboarding_setupCard_opening_before()} {@render repoNameCopyable()}{m.onboarding_setupCard_opening_after()}
      {:else}
        {m.onboarding_setupCard_creatingIsolatedCopy_before()} {@render repoNameCopyable()}
      {/if}
    {/snippet}
    {#snippet repoDone()}
      {#if skipIsolation}
        {m.onboarding_setupCard_workingDirectlyOn_before()} <code class="text-sm bg-secondary py-1 px-1.5">{displayBranch}</code> {#if worktreePath}{' '}{m.onboarding_setupCard_at_label()}
          <OpenComboButton
            filePath={worktreePath}
            isDirectory={true}
            variant="sidebar"
            compact
            class="inline"
          >
            <span
              class="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors whitespace-nowrap"
              >{shortenPath(worktreePath)}</span
            >
          </OpenComboButton>{/if}.
      {:else}
        {m.onboarding_setupCard_createdIsolatedCopy_before()} {@render repoNameCopyable()}
        {#if worktreePath}{' '}{m.onboarding_setupCard_at_label()}
          <OpenComboButton
            filePath={worktreePath}
            isDirectory={true}
            variant="sidebar"
            compact
            class="inline"
          >
            <span
              class="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors whitespace-nowrap"
              >{shortenPath(worktreePath)}</span
            >
          </OpenComboButton>{/if}.
      {/if}
    {/snippet}

    <!-- Step 2: Branch -->
    {#if branchStatus !== 'pending' && !skipIsolation}
      {@render stepRow(branchStatus, faCodeBranch, '', branchActive, branchDone)}
    {/if}
    {#snippet branchActive()}
      {#if skipIsolation}
        {#if branch}
          {m.onboarding_setupCard_workingOnBranchNamed_before()} <span class="">{branch}</span>{m.onboarding_setupCard_workingOnBranchActive_after()}
        {:else}
          {m.onboarding_setupCard_workingOnBranch_label()}
        {/if}
      {:else if branch}
        {m.onboarding_setupCard_creatingBranch_before()} <span class="">{branch}</span> {m.onboarding_setupCard_creatingBranch_middle()}
        <button
          class="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors"
          onclick={() => copyToClipboard(baseRef, m.onboarding_setupCard_baseRef_label())}>{baseRef}</button
        >{m.onboarding_setupCard_creatingBranch_after()}
      {:else}
        {m.onboarding_setupCard_creatingBranchNoName_label()}
      {/if}
    {/snippet}
    {#snippet copyableRef(text: string, label: string, copyValue?: string)}
      <button
        class="group/copy inline-flex items-center gap-0.5 underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors"
        onclick={() => copyToClipboard(copyValue ?? text, label)}
      >
        {text}<span
          class="inline-flex w-0 overflow-hidden opacity-0 group-hover/copy:w-3.5 group-hover/copy:opacity-40 transition-all duration-200"
          ><Fa icon={faCopy} size="xs" class="ml-0.5" /></span
        >
      </button>
    {/snippet}
    {#snippet branchDone()}
      {#if skipIsolation}
        {#if branch}
          {m.onboarding_setupCard_workingOnBranchNamed_before()} {@render copyableRef(branch, m.onboarding_setupCard_branchName_label())}{m.onboarding_setupCard_workingOnBranchDone_after()}
        {:else}
          {m.onboarding_setupCard_workingDirectlyOnBranch_label()}
        {/if}
      {:else if branch}
        {m.onboarding_setupCard_workingInNewBranch_before()}
        {@render copyableRef(branch, m.onboarding_setupCard_branchName_label())}{m.onboarding_setupCard_workingInNewBranch_middle()}
        {@render copyableRef(baseRef, m.onboarding_setupCard_baseRef_label())}{m.onboarding_setupCard_workingInNewBranch_after()}
      {:else}
        {m.onboarding_setupCard_branchCreated_label()}
      {/if}
    {/snippet}

    <!-- Step 3: Setup Script (optional) -->
    {#if setupScriptStatus && setupScriptStatus !== 'pending'}
      {@render stepRow(setupScriptStatus, faTerminal, 'ml-[0.5px]', setupActive, setupDone)}
    {/if}
    {#snippet setupActive()}
      {m.onboarding_setupCard_runningSetup_before()} {#if projectType}<span class="">{projectType}</span>{:else}{m.onboarding_setupCard_project_label()}{/if} {m.onboarding_setupCard_runningSetup_after()}
    {/snippet}
    {#snippet setupDone()}
      {m.onboarding_setupCard_ranSetup_before()} {#if projectType}<span class="">{projectType}</span>{:else}{m.onboarding_setupCard_project_label()}{/if} {m.onboarding_setupCard_ranSetup_middle()}{#if onFocusSetupTerminal}{' '}{m.onboarding_setupCard_ranSetupIn_middle()}
        <TooltipRich side="bottom" align="start" interactive maxWidth="22rem" delayDuration={300}>
          {#snippet trigger()}
            <button
              class="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors"
              onclick={onFocusSetupTerminal}>{m.onboarding_setupCard_terminalTab_label()}</button
            >
          {/snippet}
          {#snippet content()}
            {#if setupScriptContent}
              <pre
                class="text-xs text-muted-foreground font-mono leading-snug line-clamp-2 whitespace-pre-wrap">{setupScriptContent}</pre>
            {/if}
          {/snippet}
          {#snippet footer()}
            <span class="text-xs text-muted-foreground opacity-50">{m.onboarding_setupCard_openTerminal_footer()}</span>
          {/snippet}
        </TooltipRich>{/if}{m.onboarding_setupCard_ranSetup_after()}
    {/snippet}

    <!-- Step 4: Agent -->
    {#if agentStatus !== 'pending'}
      {@render stepRow(agentStatus, faRobot, 'ml-[-0.5px]', agentActive, agentDone)}
    {/if}
    {#snippet specialistWithTooltip()}
      <TooltipRich side="bottom" align="start" interactive maxWidth="22rem" delayDuration={300}>
        {#snippet trigger()}
          <button
            class="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors"
            onclick={openSpecialistSettings}>{displaySpecialistName}</button
          >
        {/snippet}
        {#snippet content()}
          {#if specialist}
            <p class="text-xs text-muted-foreground leading-snug">{specialist.description}</p>
          {/if}
        {/snippet}
        {#snippet footer()}
          <span class="text-xs text-muted-foreground opacity-50"> {m.onboarding_setupCard_editInSettings_footer()} </span>
        {/snippet}
      </TooltipRich>
    {/snippet}
    {#snippet agentActive()}
      {#if !hasPrompt && specialistId}
        {m.onboarding_setupCard_agentReadyNamed_before()} {@render specialistWithTooltip()} {m.onboarding_setupCard_agentReadyNamed_after()}
      {:else if !hasPrompt}
        {m.onboarding_setupCard_agentReady_label()}
      {:else if specialistId === 'spec-writer'}
        {m.onboarding_setupCard_specStartingUp_before()} {@render specialistWithTooltip()} {m.onboarding_setupCard_specStartingUp_after()}
      {:else if specialistId}
        {m.onboarding_setupCard_startingUpNamed_before()} {@render specialistWithTooltip()} {m.onboarding_setupCard_startingUpNamed_after()}
      {:else}
        {m.onboarding_setupCard_startingUp_label()}
      {/if}
    {/snippet}
    {#snippet agentDone()}
      {#if !hasPrompt && specialistId}
        {m.onboarding_setupCard_agentReadyNamed_before()} {@render specialistWithTooltip()} {m.onboarding_setupCard_agentReadyNamed_after()}
      {:else if !hasPrompt}
        {m.onboarding_setupCard_agentReady_label()}
      {:else if specialistId === 'spec-writer'}
        {m.onboarding_setupCard_specDone_before()} {@render specialistWithTooltip()} {m.onboarding_setupCard_specDone_after()}
      {:else if specialistId}
        {m.onboarding_setupCard_agentDoneNamed_before()} {@render specialistWithTooltip()} {m.onboarding_setupCard_agentDoneNamed_after()}
      {:else}
        {m.onboarding_setupCard_agentOrienting_label()}
      {/if}
    {/snippet}
  </div>
</div>

<style>
  @keyframes celebrate-bounce {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.005);
    }
    100% {
      transform: scale(1);
    }
  }

  @keyframes celebrate-glow {
    0% {
      box-shadow: 0 0 0 0 hsl(var(--primary) / 0.15);
    }
    40% {
      box-shadow: 0 0 16px 2px hsl(var(--primary) / 0.12);
    }
    100% {
      box-shadow: 0 0 0 0 hsl(var(--primary) / 0);
    }
  }

  :global(.setup-card-celebrate) {
    animation:
      celebrate-bounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
      celebrate-glow 1.2s ease-out;
  }
</style>
