<script lang="ts">
  import PhosphorGitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';

  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 16, class: className = '' }: Props = $props();
</script>

<PhosphorGitBranchIcon {size} weight="regular" class={className} aria-hidden="true" />
