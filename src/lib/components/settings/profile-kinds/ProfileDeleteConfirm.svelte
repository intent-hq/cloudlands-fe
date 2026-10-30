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
</script>

<DestructiveConfirm
  bind:open
  static={staticPosition}
  destructive
  title={m.settings_providerProfiles_removeTitle_label({ name: profileName })}
  description={folderPath
    ? m.settings_providerProfileKinds_removeFolder_description({ path: folderPath })
    : m.settings_providerProfiles_remove_description()}
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
