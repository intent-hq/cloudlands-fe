<script lang="ts">
  import { cn } from '$lib/utils';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { selectSpecialists, filterSpecialistsByGitHubAuth } from '$lib/store/slices/specialists/specialists-selectors';
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';

  interface Props {
    /** Currently selected specialist ID - null means blank agent */
    value?: string | null;
    /** Callback when specialist changes */
    onchange?: (specialistId: string | null) => void;
    /** Size variant */
    size?: 'sm' | 'md';
    /** Additional class */
    class?: string;
  }

  let {
    value = null,
    onchange,
    size = 'md',
    class: className,
  }: Props = $props();

  // All available specialists (built-in + custom), filtered by GitHub auth
  const allSpecialists = selectSpecialists();
  const visibleSpecialists = $derived.by(() =>
    filterSpecialistsByGitHubAuth($allSpecialists, githubAuthStore.state.isAuthenticated)
  );

  // Options: blank + visible specialists
  const options = $derived.by<Array<{ id: string | null; name: string; description: string }>>(
    () => [
      { id: null, name: 'Blank', description: 'No preset behavior' },
      ...visibleSpecialists.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    ],
  );

  function handleSelect(id: string | null) {
    if (id !== value) {
      onchange?.(id);
    }
  }

  // Size classes
  const avatarSize = $derived(size === 'sm' ? 20 : 28);
  const pillPadding = $derived(size === 'sm' ? 'px-2 py-1' : 'px-3 py-1.5');
  const textSize = $derived(size === 'sm' ? 'text-xs' : 'text-sm');
</script>

<div class={cn('flex flex-wrap gap-1.5', className)}>
  {#each options as option (option.id ?? '__blank__')}
    {@const isSelected = value === option.id}
    <button
      type="button"
      onclick={() => handleSelect(option.id)}
      class={cn(
        'inline-flex items-center gap-2 rounded-full transition-all cursor-pointer',
        'border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pillPadding,
        isSelected
          ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
          : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
      title={option.description}
    >
      <AuggieAvatar
        faceSeed="blank"
        colorSeed="blank"
        size={avatarSize}
        specialist={option.id}
      />
      <span class={cn('font-medium', textSize)}>{option.name}</span>
    </button>
  {/each}
</div>
