<script lang="ts">
  /**
   * **Intents on this computer**: the local pairing credentials this daemon
   * issued, with Remove. Purely props-driven so previews can render each state.
   */
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { formatRelativeTime } from '$lib/i18n/format';
  import type { LocalPairingCredential } from './local-pairing-types';

  let {
    credentials,
    removing,
    removeFailed,
    now,
    onRemove,
    onDismissFailure,
  }: {
    /** null when the list could not be read. */
    credentials: LocalPairingCredential[] | null;
    removing: Record<string, true>;
    removeFailed: Record<string, true>;
    now: Date;
    onRemove: (credentialId: string) => void;
    onDismissFailure: (credentialId: string) => void;
  } = $props();
</script>

<section class="space-y-3" aria-labelledby="local-intents-title" data-testid="local-intents">
  <div>
    <h3 id="local-intents-title" class="type-title text-foreground">
      {m.localPairing_intents_title()}
    </h3>
    <p class="max-w-2xl type-body text-muted-foreground">
      {m.localPairing_intents_description()}
    </p>
  </div>
  {#if credentials === null}
    <p class="type-body text-danger" role="alert">{m.localPairing_intents_loadFailed_error()}</p>
  {:else}
    <ListView
      virtualize={false}
      items={credentials}
      getKey={(credential) => credential.credentialId}
      getText={(credential) => credential.appName}
      status="ready"
      ariaLabel={m.localPairing_intents_title()}
      class="overflow-visible rounded-xl border border-border bg-card [&>div>div[aria-hidden=true]]:hidden"
    >
      {#snippet row({ item: credential })}
        <article
          class="border-t border-border first:border-t-0"
          aria-label={credential.appName}
          data-credential-id={credential.credentialId}
        >
          <ListRow class="items-center px-4 sm:px-5 [&>[data-slot]]:self-center">
            {#snippet title()}{credential.appName}{/snippet}
            {#snippet meta()}
              {#if credential.connected}
                <Badge variant="dot" color="green">{m.localPairing_intents_connected_label()}</Badge
                >
              {/if}
              <span>
                {credential.lastUsedAt
                  ? m.localPairing_intents_lastUsed_label({
                      time: formatRelativeTime(credential.lastUsedAt, { now }),
                    })
                  : m.localPairing_intents_neverUsed_label()}
              </span>
            {/snippet}
            {#snippet trailing()}
              <Button
                variant="ghost"
                size="sm"
                class="text-danger hover:text-danger"
                disabled={removing[credential.credentialId] === true}
                aria-label={m.localPairing_removeNamed_ariaLabel({ name: credential.appName })}
                data-testid="local-intent-remove"
                onclick={() => onRemove(credential.credentialId)}
              >
                {removing[credential.credentialId]
                  ? m.localPairing_removing_label()
                  : m.localPairing_remove_label()}
              </Button>
            {/snippet}
          </ListRow>
          {#if removeFailed[credential.credentialId]}
            <div class="mx-4 mb-3 flex items-center justify-between gap-3 sm:mx-5" role="alert">
              <p class="type-body text-danger">
                {m.localPairing_removeFailed_error({ name: credential.appName })}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => onDismissFailure(credential.credentialId)}
              >
                {m.localPairing_dismiss_label()}
              </Button>
            </div>
          {/if}
        </article>
      {/snippet}
      {#snippet empty()}
        <p
          class="rounded-xl border border-dashed border-border bg-card p-5 type-body text-muted-foreground"
        >
          {m.localPairing_intents_empty_label()}
        </p>
      {/snippet}
    </ListView>
  {/if}
</section>
