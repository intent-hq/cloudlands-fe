<script lang="ts">
  /**
   * Confirmation before keyless Kilo autocomplete is turned on: what is sent,
   * Kilo's data terms and the IP rate limit (approved mock-up). Cancel keeps
   * autocomplete off.
   */
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  let {
    open = false,
    static: staticPosition = false,
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    /** Render in place (sandbox previews) instead of over the page. */
    static?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  const TERMS_URL = 'https://kilo.ai/terms'; // i18n-ignore (URL)
  const PRIVACY_URL = 'https://kilo.ai/privacy'; // i18n-ignore (URL)
</script>

<ContentDialog
  {open}
  static={staticPosition}
  size="sm"
  title={m.settings_autocomplete_kiloConfirm_title()}
  description={m.settings_autocomplete_kiloConfirm_intro()}
  closeLabel={m.settings_autocomplete_cancel()}
  onClose={onCancel}
>
  <div class="flex flex-col gap-3" data-testid="autocomplete-kilo-confirm">
    <ul class="type-body list-disc space-y-1 pl-5 text-foreground">
      <li>{m.settings_autocomplete_kiloConfirm_sentConversation()}</li>
      <li>{m.settings_autocomplete_kiloConfirm_sentDraft()}</li>
    </ul>
    <p class="type-body text-muted-foreground">{m.settings_autocomplete_kiloConfirm_terms()}</p>
    <p class="type-body flex flex-wrap items-center gap-x-2">
      <Button
        variant="link"
        size="sm"
        href={TERMS_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="h-auto px-0">{m.settings_autocomplete_kiloConfirm_termsLink()}</Button
      >
      <span class="text-ghost" aria-hidden="true">·</span>
      <Button
        variant="link"
        size="sm"
        href={PRIVACY_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="h-auto px-0">{m.settings_autocomplete_kiloConfirm_privacyLink()}</Button
      >
    </p>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={onCancel}>{m.settings_autocomplete_cancel()}</Button>
    <Button onclick={onConfirm}>{m.settings_autocomplete_kiloConfirm_confirm()}</Button>
  {/snippet}
</ContentDialog>
