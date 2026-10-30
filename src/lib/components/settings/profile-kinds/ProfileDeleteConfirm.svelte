<script lang="ts">
  /**
   * Remove-profile confirmation. A Different-login profile names the sign-in
   * folder that stays on disk (Intent never deletes account folders); other
   * kinds keep today's wording. Presentational: the parent removes.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';

  interface Props {
    open?: boolean;
    /** Render in place instead of as a modal overlay (component previews). */
    static?: boolean;
    profileName: string;
    /** The Different-login folder saved on the profile (`~/…` form). */
    folderPath?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(true),
    static: staticPosition = false,
    profileName,
    folderPath,
    onConfirm,
    onCancel,
  }: Props = $props();

  // Split the localized sentence around {path} so the folder renders as code.
  const PATH_SLOT = '\u0000';
  const folderParts = $derived(
    folderPath
      ? m
          .settings_providerProfileKinds_removeFolder_description({ path: PATH_SLOT })
          .split(PATH_SLOT)
      : [],
  );
  // Wrap only after a `/`, never at the hyphens inside a folder name.
  const pathSegments = $derived(
    folderPath
      ? folderPath.split('/').map((part, i, all) => (i < all.length - 1 ? `${part}/` : part))
      : [],
  );
</script>

<DestructiveConfirm
  bind:open
  static={staticPosition}
  destructive
  title={m.settings_providerProfiles_removeTitle_label({ name: profileName })}
  description={folderPath ? undefined : m.settings_providerProfiles_remove_description()}
  details={folderPath ? folderDescription : undefined}
  confirmLabel={m.settings_providerProfiles_remove_label()}
  onConfirm={() => {
    onConfirm?.();
    open = false;
  }}
  onCancel={() => {
    onCancel?.();
    open = false;
  }}
/>

{#snippet folderDescription()}
  <p
    class="type-caption break-words text-muted-foreground"
    data-testid="provider-profile-remove-folder-description"
  >
    {#each folderParts as part, index (index)}{#if index > 0}<code
          class="rounded border border-border bg-muted px-1 py-0.5 font-mono type-caption text-foreground"
          data-testid="provider-profile-remove-folder-path"
          >{#each pathSegments as segment, i (i)}{#if i > 0}<wbr />{/if}<span
              class="whitespace-nowrap">{segment}</span
            >{/each}</code
        >{/if}{part}{/each}
  </p>
{/snippet}
