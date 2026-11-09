<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    provider?: 'claude' | 'codex';
    enabled?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'provider-fast-mode-menu',
    title: 'Provider ⋯ menu: Fast mode',
    defaultState: 'off',
    states: {
      off: { props: { provider: 'claude', enabled: false } },
      on: { props: { provider: 'claude', enabled: true } },
      codex: { props: { provider: 'codex', enabled: true } },
    },
  });
</script>

<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowsRotate, faPen } from '@fortawesome/free-solid-svg-icons';
  import { Menu } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import {
    fastModeSupportReceived,
    hydrateProviderFastMode,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import ProviderFastModeMenuItems from './ProviderFastModeMenuItems.svelte';

  let { provider = 'claude', enabled = false }: Props = $props();

  $effect.pre(() => {
    store.dispatch(fastModeSupportReceived(true));
    store.dispatch(hydrateProviderFastMode({ [provider]: enabled }));
  });
</script>

<Menu.Root open staticPosition>
  <Menu.Content
    class="w-fit"
    aria-label={m.settings_providerProfiles_actions_ariaLabel({
      name: provider === 'codex' ? 'Codex' : 'Claude Code',
    })}
  >
    <div class={provider === 'codex' ? 'w-56' : 'w-64'}>
      <ProviderFastModeMenuItems providerRef={provider} />
      <Menu.Separator />
      <Menu.Item class="cursor-pointer text-foreground">
        <span class="flex size-4 shrink-0 items-center justify-center">
          <Fa icon={faPen} class="size-3.5 text-muted-foreground" />
        </span>
        {m.settings_providerProfiles_edit_label()}
      </Menu.Item>
      <Menu.Item class="cursor-pointer text-foreground">
        <span class="flex size-4 shrink-0 items-center justify-center">
          <Fa icon={faArrowsRotate} class="size-3.5 text-muted-foreground" />
        </span>
        {m.settings_providers_recheck_label()}
      </Menu.Item>
    </div>
  </Menu.Content>
</Menu.Root>
