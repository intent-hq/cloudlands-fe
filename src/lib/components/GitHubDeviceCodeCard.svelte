<script lang="ts">
  import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { handleLink } from '$features/navigation/link-handler';

  interface Props {
    /** Device-flow code the user enters on GitHub (PROTOCOL §5.27). */
    userCode: string;
    /** Where the user enters the code (usually https://github.com/login/device). */
    verificationUri: string;
    /** Compact layout for tight surfaces like the sidebar banner. */
    compact?: boolean;
  }

  let { userCode, verificationUri, compact = false }: Props = $props();

  function handleOpenGitHub() {
    // GitHub URLs always route to the external browser via the link handler.
    void handleLink(verificationUri, {});
  }
</script>

<div class={compact ? 'space-y-2' : 'space-y-3'}>
  <div
    class="flex items-center justify-center gap-1 bg-muted rounded {compact
      ? 'py-1.5 px-2'
      : 'py-3 px-4'}"
  >
    <span
      class="font-mono tracking-[0.2em] text-foreground select-all {compact
        ? 'text-base'
        : 'text-2xl'}"
    >
      {userCode}
    </span>
    <CopyButton text={userCode} size={compact ? 'xs' : 'sm'} label="Copy code" />
  </div>
  <button
    type="button"
    class="inline-flex items-center justify-center gap-2 bg-[#238636] text-white border-none rounded cursor-pointer hover:bg-[#2ea043] {compact
      ? 'px-3 py-1.5 text-xs'
      : 'px-6 py-3 text-base w-full'}"
    onclick={handleOpenGitHub}
  >
    <span>Open GitHub</span>
    <Fa icon={faArrowUpRightFromSquare} size="xs" />
  </button>
  <p class="text-xs text-subtle">
    Enter this code at
    <span class="font-mono break-all">{verificationUri}</span>
  </p>
</div>
