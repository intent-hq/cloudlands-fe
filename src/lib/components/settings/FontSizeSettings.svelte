<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { selectFontSize } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    isFontSize,
    setFontSize,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const fontSize = selectFontSize();
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'font-size',
          title: m.settings_font_size_label(),
          entries: [
            {
              kind: 'select',
              id: 'appearance-font-size',
              label: m.settings_font_size_label(),
              description: m.settings_font_size_description(),
              options: [
                { value: 'small', label: m.settings_font_size_small() },
                { value: 'default', label: m.settings_font_size_default() },
                { value: 'large', label: m.settings_font_size_large() },
                { value: 'extra-large', label: m.settings_font_size_extraLarge() },
              ],
              get: () => $fontSize,
              set: (value) => {
                if (isFontSize(value)) appStore.dispatch(setFontSize(value));
              },
            },
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} embedded compact={false} />
