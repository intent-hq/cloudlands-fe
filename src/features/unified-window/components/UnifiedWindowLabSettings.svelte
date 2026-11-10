<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    enabled: boolean;
    onchange: (enabled: boolean) => void;
  }

  let { enabled, onchange }: Props = $props();

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'unified-window-lab',
          title: m.unifiedWindow_lab_label(),
          entries: [
            {
              kind: 'switch',
              id: 'unified-window-lab-switch',
              size: 'sm',
              label: m.unifiedWindow_lab_label(),
              description: m.unifiedWindow_lab_description(),
              get: () => enabled,
              set: onchange,
            },
          ],
        },
      ],
    }),
  );
</script>

<section
  id="unified-window"
  data-highlight-id="unified-window"
  data-slot="settings-section-body"
  class="px-6 py-4"
>
  <SettingsForm {schema} embedded compact={false} />
</section>
