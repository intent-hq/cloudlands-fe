<script module lang="ts">
  import type { ComponentProps } from 'svelte';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import ProviderCard from './ProviderCard.svelte';

  type Props = ComponentProps<typeof ProviderCard>;
  const provider: Props['provider'] = {
    id: 'claude-code',
    name: 'Anthropic Claude Code',
    available: true,
    authenticated: false,
    statusLoading: false,
    authDetails: undefined,
    docsUrl: 'https://example.com/provider-docs',
    installCommand: '',
    hasNpxFallback: false,
  };
  const base: Props = {
    provider,
    brand: { color1: '#D97757', color2: '#D97757' },
    npxStatus: null,
    onSelect: () => {},
  };
  export const preview = definePreview<Props>({
    id: 'provider-card',
    title: 'Onboarding provider card',
    defaultState: 'login',
    states: {
      login: { props: base },
      selected: {
        props: { ...base, provider: { ...provider, authenticated: true }, selected: true },
      },
      connected: { props: { ...base, provider: { ...provider, authenticated: true } } },
      grok: {
        props: {
          ...base,
          provider: { ...provider, id: 'grok', name: 'Grok', authenticated: true },
          brand: { color1: '#000000', color2: '#252525' },
        },
      },
      codex: {
        props: {
          ...base,
          provider: { ...provider, id: 'codex', name: 'Codex', authenticated: true },
          brand: { color1: '#CBE6FF', color2: '#DDBEFC', isLight: true },
        },
      },
      unavailable: { props: { ...base, provider: { ...provider, available: false } } },
    },
  });
</script>

<script lang="ts">
  let props: Props = $props();
</script>

<div class="w-66 max-w-full" data-provider-card-fixture>
  <ProviderCard {...props} />
</div>
