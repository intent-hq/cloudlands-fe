<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';

  let {
    providerId,
    configured = false,
    status = 'loading',
    busy = false,
    failed = false,
    onSave,
    onRemove,
    onRetry,
  }: {
    providerId: string;
    configured?: boolean;
    status?: 'loading' | 'ready' | 'unavailable' | 'error';
    busy?: boolean;
    failed?: boolean;
    onSave: (token: string) => void;
    onRemove: () => void;
    onRetry: () => void;
  } = $props();

  // This draft never enters Redux, persistence, or a response payload.
  let draft = $state('');
  const inputId = $derived(`provider-token-${providerId}`);
  function save() {
    if (busy || !draft.trim()) return;
    const token = draft;
    draft = '';
    onSave(token);
  }
</script>

<SettingsFieldRow
  id={`${inputId}-row`}
  label={m.settings_providerToken_label()}
  htmlFor={status === 'ready' ? inputId : undefined}
  compact
  {busy}
  error={failed ? m.settings_providerToken_error() : undefined}
>
  {#snippet descriptionContent()}
    {#if status === 'ready'}
      {providerId === 'claude-code'
        ? m.settings_providerToken_claude()
        : m.settings_providerToken_codex()}
      {m.settings_providerToken_nextLaunch()}
    {:else if status === 'loading'}
      {m.settings_providerToken_loading()}
    {:else if status === 'error'}
      {m.settings_providerToken_loadError()}
    {:else}
      {m.settings_providerToken_unavailable()}
    {/if}
  {/snippet}
  {#snippet control({ descriptionId, errorId })}
    {#if status === 'ready'}
      <div class="space-y-3">
        <p role="status" class="type-caption text-muted-foreground">
          {configured ? m.settings_providerToken_saved() : m.settings_providerToken_absent()}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <Input
            id={inputId}
            type="password"
            autocomplete="new-password"
            spellcheck={false}
            bind:value={draft}
            disabled={busy}
            aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ')}
            class="min-w-0 flex-1 basis-48"
          />
          <div class="flex max-w-full flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || !draft.trim()} onclick={save}>
              {configured ? m.settings_providerToken_replace() : m.settings_providerToken_save()}
            </Button>
            {#if configured}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onclick={() => {
                  draft = '';
                  onRemove();
                }}
              >
                {m.settings_providerToken_remove()}
              </Button>
            {/if}
          </div>
        </div>
        <p class="type-caption text-muted-foreground">{m.settings_providerToken_manual()}</p>
      </div>
    {:else if status === 'error'}
      <Button size="sm" variant="secondary" onclick={onRetry}>
        {m.settings_providers_tryAgain()}
      </Button>
    {:else if status === 'unavailable'}
      <p class="type-caption text-muted-foreground">{m.settings_providerToken_manual()}</p>
    {/if}
  {/snippet}
</SettingsFieldRow>
