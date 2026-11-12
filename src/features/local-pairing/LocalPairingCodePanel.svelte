<script lang="ts">
  /**
   * B's code panel: the action that shows a code, the loopback listener prompt,
   * the code with its countdown, and every way a code ends. Purely
   * props-driven so previews can render each state.
   */
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { formatCompactDuration } from '$lib/i18n/format';
  import type { CodePanelView } from './local-pairing-model';
  import { LOCAL_PAIRING_MAX_ATTEMPTS } from './local-pairing-model';

  let {
    view,
    codeText,
    onShow,
    onConfirmListener,
    onCancel,
    onClose,
  }: {
    view: CodePanelView;
    /** Display form of the code (`KTP-82M`); null when this window no longer holds it. */
    codeText: string | null;
    onShow: () => void;
    onConfirmListener: () => void;
    onCancel: () => void;
    onClose: () => void;
  } = $props();

  type Ending = { title: string; description: string; tone: 'success' | 'muted' };
  const ending = $derived.by((): Ending | null => {
    switch (view.kind) {
      case 'connected':
        return {
          title: m.localPairing_connected_title(),
          description: view.appName
            ? m.localPairing_connected_description({ name: view.appName })
            : m.localPairing_connected_unknown_description(),
          tone: 'success',
        };
      case 'expired':
        return {
          title: m.localPairing_expired_title(),
          description: m.localPairing_expired_description(),
          tone: 'muted',
        };
      case 'locked':
        return {
          title: m.localPairing_locked_title(),
          description: m.localPairing_locked_description(),
          tone: 'muted',
        };
      case 'cancelled':
        if (view.reason === 'tunnel-active')
          return {
            title: m.localPairing_tunnelCancelled_title(),
            description: m.localPairing_tunnelCancelled_description(),
            tone: 'muted',
          };
        return view.reason === 'replaced'
          ? {
              title: m.localPairing_replaced_title(),
              description: m.localPairing_replaced_description(),
              tone: 'muted',
            }
          : {
              title: m.localPairing_cancelled_title(),
              description: m.localPairing_cancelled_description(),
              tone: 'muted',
            };
      default:
        return null;
    }
  });
  const failure = $derived(
    view.kind === 'failed'
      ? view.failure === 'listener-failed'
        ? m.localPairing_listenerFailed_error()
        : view.failure === 'remote-access-on'
          ? m.localPairing_remoteAccessOn_error()
          : m.localPairing_createFailed_error()
      : null,
  );
</script>

<section
  class="space-y-3"
  aria-labelledby="local-pairing-title"
  data-testid="local-pairing-panel"
  data-view={view.kind}
>
  <div>
    <h3 id="local-pairing-title" class="type-title text-foreground">
      {m.localPairing_section_title()}
    </h3>
    <p class="max-w-2xl type-body text-muted-foreground">
      {m.localPairing_section_description()}
    </p>
  </div>

  {#if view.kind === 'closed'}
    <div>
      <Button variant="secondary" size="sm" onclick={onShow} data-testid="local-pairing-show">
        {m.localPairing_show_label()}
      </Button>
    </div>
  {:else}
    <div class="rounded-xl border border-border bg-card p-5" aria-live="polite">
      {#if view.kind === 'creating' || view.kind === 'enabling-listener'}
        <p class="type-body text-muted-foreground" role="status">
          {view.kind === 'creating'
            ? m.localPairing_creating_label()
            : m.localPairing_listener_enabling_label()}
        </p>
      {:else if view.kind === 'confirm-listener'}
        <div class="space-y-3" data-testid="local-pairing-listener-prompt">
          <div class="space-y-1">
            <p class="type-body font-medium text-foreground">
              {m.localPairing_listener_title()}
            </p>
            <p class="max-w-xl type-body text-muted-foreground">
              {m.localPairing_listener_description()}
            </p>
          </div>
          <div class="flex gap-2">
            <Button variant="primary" size="sm" onclick={onConfirmListener}>
              {m.localPairing_listener_confirm_label()}
            </Button>
            <Button variant="ghost" size="sm" onclick={onClose}>
              {m.localPairing_listener_decline_label()}
            </Button>
          </div>
        </div>
      {:else if view.kind === 'active'}
        <div class="space-y-4">
          <p class="max-w-xl type-body text-muted-foreground">
            {m.localPairing_code_instructions()}
          </p>
          {#if codeText}
            <p
              class="font-mono text-4xl font-semibold tracking-[0.2em] text-foreground select-all"
              aria-label={m.localPairing_code_ariaLabel({ code: codeText.split('').join(' ') })}
              data-testid="local-pairing-code"
            >
              {codeText}
            </p>
          {/if}
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 type-body text-muted-foreground">
            <span data-testid="local-pairing-countdown">
              {m.localPairing_code_expiresIn_label({
                time: formatCompactDuration(view.remainingMs),
              })}
            </span>
            {#if view.attemptsRemaining < LOCAL_PAIRING_MAX_ATTEMPTS}
              <span class="text-warning" data-testid="local-pairing-attempts">
                {m.localPairing_code_attemptsRemaining_label({ count: view.attemptsRemaining })}
              </span>
            {/if}
          </div>
          {#if view.cancelFailed}
            <p class="type-body text-danger" role="alert">{m.localPairing_cancelFailed_error()}</p>
          {/if}
          <div class="flex gap-2">
            <Button variant="secondary" size="sm" onclick={onCancel}>
              {m.localPairing_cancel_label()}
            </Button>
          </div>
        </div>
      {:else if ending}
        <div class="space-y-3">
          <div class="space-y-1">
            <p
              class="type-body font-medium {ending.tone === 'success'
                ? 'text-success'
                : 'text-foreground'}"
            >
              {ending.title}
            </p>
            <p class="max-w-xl type-body text-muted-foreground">{ending.description}</p>
          </div>
          <div class="flex gap-2">
            {#if view.kind === 'connected'}
              <Button variant="secondary" size="sm" onclick={onClose}>
                {m.localPairing_done_label()}
              </Button>
            {:else}
              <Button variant="secondary" size="sm" onclick={onShow}>
                {m.localPairing_newCode_label()}
              </Button>
              <Button variant="ghost" size="sm" onclick={onClose}>
                {m.localPairing_close_label()}
              </Button>
            {/if}
          </div>
        </div>
      {:else if failure}
        <div class="space-y-3">
          <p class="type-body text-danger" role="alert">{failure}</p>
          <div class="flex gap-2">
            <Button variant="secondary" size="sm" onclick={onShow}>
              {m.localPairing_retry_label()}
            </Button>
            <Button variant="ghost" size="sm" onclick={onClose}>
              {m.localPairing_close_label()}
            </Button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>
