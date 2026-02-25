<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
    faArrowRight,
    faCodeBranch,
    faUsers,
    faComments,
    faLayerGroup,
    faRocket,
  } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import { track } from '$lib/services/analytics';

  interface Props {
    onComplete: () => void;
  }

  let { onComplete }: Props = $props();

  let currentStep = $state(0);
  let hasMounted = $state(false);

  import { onMount } from 'svelte';
  onMount(() => {
    hasMounted = true;
    try {
      track('Viewed Onboarding', { step: 0 });
    } catch {}
  });

  function nextStep() {
    if (currentStep < 2) {
      currentStep++;
      try {
        track('Viewed Onboarding', { step: currentStep });
      } catch {}
    } else {
      completeOnboarding();
    }
  }

  function completeOnboarding() {
    try {
      track('Completed Onboarding', { skipped: false, final_step: currentStep });
    } catch {}
    onComplete();
  }

  function skipOnboarding() {
    try {
      track('Completed Onboarding', { skipped: true, final_step: currentStep });
    } catch {}
    onComplete();
  }

  const steps = [
    {
      title: 'Welcome to Intent',
      subtitle: 'A workspace for building software with AI agents',
    },
    {
      title: 'How it works',
      subtitle: 'Three simple steps to ship code faster',
    },
    {
      title: 'Ready to build?',
      subtitle: "Let's create your first workspace",
    },
  ];
</script>

<div class="w-full max-w-[560px]">
  {#if hasMounted}
    <!-- Progress dots -->
    <div class="flex items-center gap-2 mb-10" in:fade={{ duration: 300, delay: 200 }}>
      {#each steps as _, i}
        <button
          class="h-1.5 rounded-full transition-all duration-300 cursor-pointer
            {i === currentStep
            ? 'w-6 bg-foreground'
            : i < currentStep
              ? 'w-1.5 bg-foreground/40'
              : 'w-1.5 bg-foreground/15'}"
          onclick={() => {
            currentStep = i;
          }}
          aria-label="Go to step {i + 1}"
        ></button>
      {/each}
    </div>

    <!-- Step content -->
    {#key currentStep}
      <div in:fly={{ x: 40, duration: 350, easing: cubicOut }} out:fade={{ duration: 150 }}>
        {#if currentStep === 0}
          <!-- Step 1: Welcome -->
          <div class="relative mb-9">
            <img
              src="/icons/Icon-iOS-Default-68x68@2x.png"
              alt="Intent Logo"
              class="size-20 absolute left-0 top-1.25 -translate-x-[calc(100%+2rem)]"
            />
            <h1 class="text-2xl font-semibold mb-3">{steps[0].title}</h1>
            <p class="text-muted-foreground/80 text-[15px] leading-relaxed">
              Intent gives you a dedicated workspace for each coding task. Describe what you want to
              build, and AI agents will write the code, run tests, and prepare changes for your
              review.
            </p>
          </div>

          <!-- Key concept cards -->
          <div class="flex flex-col gap-3 mb-10">
            <div
              class="flex items-start gap-3.5 p-4 rounded-lg border border-border/60 bg-card/50"
              in:fly={{ y: 15, duration: 300, delay: 100, easing: cubicOut }}
            >
              <div
                class="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary shrink-0 mt-0.5"
              >
                <Fa icon={faLayerGroup} size="sm" />
              </div>
              <div>
                <p class="text-sm font-medium mb-0.5">Isolated workspaces</p>
                <p class="text-xs text-muted-foreground/70">
                  Each task gets its own git branch. Agents work without touching your main code.
                </p>
              </div>
            </div>

            <div
              class="flex items-start gap-3.5 p-4 rounded-lg border border-border/60 bg-card/50"
              in:fly={{ y: 15, duration: 300, delay: 200, easing: cubicOut }}
            >
              <div
                class="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary shrink-0 mt-0.5"
              >
                <Fa icon={faUsers} size="sm" />
              </div>
              <div>
                <p class="text-sm font-medium mb-0.5">Parallel agents</p>
                <p class="text-xs text-muted-foreground/70">
                  Spin up multiple agents to work on different parts of your task simultaneously.
                </p>
              </div>
            </div>
          </div>
        {:else if currentStep === 1}
          <!-- Step 2: How it works -->
          <div class="mb-9">
            <h1 class="text-2xl font-semibold mb-3">{steps[1].title}</h1>
            <p class="text-muted-foreground/80 text-[15px] leading-relaxed">
              Intent follows a simple workflow to turn your ideas into code.
            </p>
          </div>

          <div class="flex flex-col gap-0 mb-10">
            <!-- Step A: Describe -->
            <div class="flex gap-4" in:fly={{ y: 15, duration: 300, delay: 80, easing: cubicOut }}>
              <div class="flex flex-col items-center">
                <div
                  class="flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-xs font-semibold shrink-0"
                >
                  1
                </div>
                <div class="w-px flex-1 bg-border/60 my-1.5"></div>
              </div>
              <div class="pb-5">
                <p class="text-sm font-medium mb-1">Describe your task</p>
                <p class="text-xs text-muted-foreground/70 leading-relaxed">
                  Pick a repo and tell the agent what you want — a feature, bug fix, refactor, or
                  anything else. Attach issues from Linear, GitHub, or Sentry for context.
                </p>
              </div>
            </div>

            <!-- Step B: Agents work -->
            <div class="flex gap-4" in:fly={{ y: 15, duration: 300, delay: 180, easing: cubicOut }}>
              <div class="flex flex-col items-center">
                <div
                  class="flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-xs font-semibold shrink-0"
                >
                  2
                </div>
                <div class="w-px flex-1 bg-border/60 my-1.5"></div>
              </div>
              <div class="pb-5">
                <p class="text-sm font-medium mb-1">Agents write the code</p>
                <p class="text-xs text-muted-foreground/70 leading-relaxed">
                  An agent creates a branch, writes code, and runs commands. You can chat with it,
                  give feedback, or spin up more agents to work in parallel.
                </p>
              </div>
            </div>

            <!-- Step C: Review & ship -->
            <div class="flex gap-4" in:fly={{ y: 15, duration: 300, delay: 280, easing: cubicOut }}>
              <div class="flex flex-col items-center">
                <div
                  class="flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background text-xs font-semibold shrink-0"
                >
                  3
                </div>
              </div>
              <div class="pb-2">
                <p class="text-sm font-medium mb-1">Review & ship</p>
                <p class="text-xs text-muted-foreground/70 leading-relaxed">
                  Review the code changes, commit, and create a pull request — all from within
                  Intent.
                </p>
              </div>
            </div>
          </div>
        {:else if currentStep === 2}
          <!-- Step 3: Ready to build -->
          <div class="mb-9">
            <h1 class="text-2xl font-semibold mb-3">{steps[2].title}</h1>
            <p class="text-muted-foreground/80 text-[15px] leading-relaxed">
              Create a workspace to get started. You'll pick a repository, describe what you want to
              build, and an agent will start working on it.
            </p>
          </div>

          <div class="flex flex-col gap-3 mb-10">
            <div
              class="flex items-start gap-3.5 p-4 rounded-lg border border-border/60 bg-card/50"
              in:fly={{ y: 15, duration: 300, delay: 100, easing: cubicOut }}
            >
              <div
                class="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary shrink-0 mt-0.5"
              >
                <Fa icon={faCodeBranch} size="sm" />
              </div>
              <div>
                <p class="text-sm font-medium mb-0.5">Pick any repo</p>
                <p class="text-xs text-muted-foreground/70">
                  Point to a local repo or clone from GitHub. Intent creates a branch automatically.
                </p>
              </div>
            </div>

            <div
              class="flex items-start gap-3.5 p-4 rounded-lg border border-border/60 bg-card/50"
              in:fly={{ y: 15, duration: 300, delay: 200, easing: cubicOut }}
            >
              <div
                class="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary shrink-0 mt-0.5"
              >
                <Fa icon={faComments} size="sm" />
              </div>
              <div>
                <p class="text-sm font-medium mb-0.5">Describe what you want</p>
                <p class="text-xs text-muted-foreground/70">
                  Be as specific or as vague as you like. The agent will ask clarifying questions if
                  needed.
                </p>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/key}

    <!-- Navigation buttons -->
    <div class="flex items-center justify-between" in:fade={{ duration: 300, delay: 300 }}>
      <button
        class="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
        onclick={skipOnboarding}
      >
        Skip
      </button>

      <Button onclick={nextStep} class="gap-2 px-5">
        {#if currentStep === 2}
          Create a workspace
          <Fa icon={faRocket} size="sm" />
        {:else}
          Continue
          <Fa icon={faArrowRight} size="sm" />
        {/if}
      </Button>
    </div>
  {/if}
</div>
