<script lang="ts">
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import Fa from 'svelte-fa';
  import { faCodeBranch, faTerminal, faFileCode } from '@fortawesome/free-solid-svg-icons';
  import { fade } from 'svelte/transition';

  interface Props {
    agentId?: string | null;
  }

  let { agentId }: Props = $props();
</script>

<div class="flex flex-col justify-center text-left py-6 pt-3">
  <div class="mb-4">
    <AuggieAvatar faceSeed={agentId || ''} colorSeed={agentId || ''} size={32} />
  </div>

  <p class="text-foreground font-medium text-[15px] mb-1.5">What would you like to build?</p>
  <p class="text-muted-foreground/70 text-sm mb-5 leading-relaxed">
    Describe a feature, bug fix, or refactor. I'll create a plan, write the code, and run tests.
  </p>

  <!-- Capability hints -->
  <div class="flex flex-col gap-2" in:fade={{ duration: 300, delay: 200 }}>
    <div class="flex items-center gap-2.5 text-xs text-muted-foreground/50">
      <Fa icon={faFileCode} class="w-3 shrink-0" />
      <span>I can read and write files across your repo</span>
    </div>
    <div class="flex items-center gap-2.5 text-xs text-muted-foreground/50">
      <Fa icon={faTerminal} class="w-3 shrink-0" />
      <span>I can run commands, tests, and build tools</span>
    </div>
    <div class="flex items-center gap-2.5 text-xs text-muted-foreground/50">
      <Fa icon={faCodeBranch} class="w-3 shrink-0" />
      <span>All changes are on an isolated branch</span>
    </div>
  </div>
</div>
