<script lang="ts">
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
  import * as Card from '$lib/components/ui/card';
  import { Separator } from '$lib/components/ui/separator';
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    canAdministerHost: boolean;
    sharingEnabled: boolean | null;
    sharingChecking: boolean;
    sharingEnabling: boolean;
    sharingError: string | null;
    onEnableSharing?: () => void;
  }

  let {
    canAdministerHost,
    sharingEnabled,
    sharingChecking,
    sharingEnabling,
    sharingError,
    onEnableSharing,
  }: Props = $props();

  const sharingSetup = $derived(
    defineSettings({
      sections: [
        {
          id: 'workspace-sharing-setup',
          title: m.workspace_share_enableSharing_label(),
          entries: [
            {
              id: 'workspace-sharing-enable',
              kind: 'switch',
              label: m.workspace_share_enableSharing_label(),
              description: canAdministerHost
                ? undefined
                : m.workspace_share_sharingAdminRequired_notice(),
              get: () => sharingEnabled === true,
              set: (enabled) => {
                if (enabled && canAdministerHost && !sharingChecking && !sharingEnabling)
                  onEnableSharing?.();
              },
              disabled: !canAdministerHost || sharingChecking || sharingEnabling,
              busy: sharingChecking || sharingEnabling,
              error: sharingError ?? undefined,
              status: sharingEnabling
                ? m.workspace_share_sharingEnabling_label()
                : sharingChecking
                  ? m.workspace_share_sharingChecking_label()
                  : undefined,
              statusTone: 'subtle',
              class: 'grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-0 first:pt-0 last:pb-0',
            },
          ],
        },
      ],
    }),
  );
</script>

<Card.Root
  border="none"
  class="rounded-lg border border-border bg-muted/30"
  aria-labelledby="share-setup-title"
  data-testid="share-setup-card"
>
  <Card.Content class="space-y-3.5">
    <div class="space-y-1">
      <h3 id="share-setup-title" class="type-title font-semibold">
        {m.workspace_share_turnOnSharing_label()}
      </h3>
      <p class="type-caption text-subtle">
        {m.workspace_share_enableSharing_description()}
      </p>
    </div>
    <div class="space-y-2.5">
      <div class="flex items-center gap-3">
        <WarningCircleIcon size={16} class="shrink-0 text-subtle" aria-hidden="true" />
        <div class="min-w-0 space-y-0.5">
          <p class="type-caption font-semibold">{m.workspace_share_remoteAccess_label()}</p>
          <p class="type-caption text-subtle">
            {m.workspace_share_remoteAccess_description()}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <WarningCircleIcon size={16} class="shrink-0 text-subtle" aria-hidden="true" />
        <div class="min-w-0 space-y-0.5">
          <p class="type-caption font-semibold">{m.workspace_share_tailcat_label()}</p>
          <p class="type-caption text-subtle">
            {m.workspace_share_tailcat_description()}
          </p>
        </div>
      </div>
    </div>
    <Separator />
    <SettingsForm schema={sharingSetup} embedded />
  </Card.Content>
</Card.Root>
