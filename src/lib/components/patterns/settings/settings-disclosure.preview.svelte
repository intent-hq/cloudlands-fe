<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    open?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'settings-disclosure',
    title: 'Settings disclosure',
    defaultState: 'closed',
    states: {
      closed: { props: { open: false } },
      open: { props: { open: true } },
    },
  });
</script>

<script lang="ts">
  import { SettingsDisclosure } from '$lib/components/patterns/settings';

  let { open = false }: Props = $props();
  let expanded = $derived(open);
</script>

<section class="w-full bg-background p-6 text-foreground" data-testid="settings-disclosure-preview">
  <SettingsDisclosure label="Advanced" flush muted bind:open={expanded}>
    <p class="type-body text-muted-foreground">Advanced settings</p>
  </SettingsDisclosure>
</section>
