<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    marked?: boolean;
    accountFolder?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'provider-remote-menu',
    title: "Provider ⋯ menu: the Default's Use on remote machines",
    defaultState: 'unmarked',
    states: {
      unmarked: { props: {} },
      marked: { props: { marked: true } },
      'account-folder': { props: { accountFolder: true } },
    },
  });
</script>

<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowsRotate, faPen } from '@fortawesome/free-solid-svg-icons';
  import { Menu } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import { providerProfilesLoaded } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { selectProviderProfilesRevision } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import ProviderRemoteMenuItems from './ProviderRemoteMenuItems.svelte';

  let { marked = false, accountFolder = false }: Props = $props();

  $effect.pre(() => {
    const revision = selectProviderProfilesRevision.select(store.state) + 1;
    store.dispatch(
      providerProfilesLoaded([], revision, [
        {
          baseProviderId: 'claude-code',
          providerRef: 'claude-code',
          name: 'Default',
          env: accountFolder
            ? [{ key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '~/.claude-work' }]
            : [],
          remoteCompatible: marked && !accountFolder,
          ...(marked && !accountFolder
            ? {}
            : {
                remoteIncompatibility: accountFolder
                  ? { reason: 'account-folder', keys: ['CLAUDE_CONFIG_DIR'] }
                  : { reason: 'not-marked', keys: [] },
              }),
          remoteLaunch: marked ? 'send' : 'machine-sign-in',
        },
      ]),
    );
  });
</script>

<Menu.Root open staticPosition>
  <Menu.Content
    class="w-fit"
    aria-label={m.settings_providerProfiles_actions_ariaLabel({ name: 'Default' })}
  >
    <div class="w-64">
      <ProviderRemoteMenuItems providerId="claude-code" />
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
