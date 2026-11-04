<script lang="ts">
  /**
   * Browser access (Settings → Mobile): lets a browser on another device use
   * this app, including every backend it connects to, through a private HTTPS
   * front-end such as `tailscale serve`. Main owns the setting and server; the
   * browser-access saga carries requests and this section renders its slice.
   */
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatCompactDuration } from '$lib/i18n/format';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingEntry,
  } from '$lib/components/patterns/settings';
  import { CopyInput } from '$lib/components/patterns/settings/custom-controls';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectBrowserAccess,
    selectBrowserAccessBusy,
    selectBrowserAccessFailed,
    selectBrowserAccessSignInCode,
    selectBrowserAccessSignInCodeFailed,
  } from '$store/renderer/slices/browser-access/browser-access-selectors';
  import {
    createBrowserAccessSignInCodeRequested,
    loadBrowserAccessRequested,
    resetBrowserAccessKeyRequested,
    setBrowserAccessEnabledRequested,
    setBrowserAccessPortRequested,
  } from '$store/renderer/slices/browser-access/browser-access-slice';
  import {
    BROWSER_ACCESS_MAX_PORT,
    BROWSER_ACCESS_MIN_PORT,
    isValidBrowserAccessPort,
  } from '$shared/types/browser-access';

  const access$ = selectBrowserAccess();
  const busy$ = selectBrowserAccessBusy();
  const failed$ = selectBrowserAccessFailed();
  const signInCode$ = selectBrowserAccessSignInCode();
  const signInCodeFailed$ = selectBrowserAccessSignInCodeFailed();

  // Ticks once a second while a sign-in code is shown, for its countdown.
  let now = $state(Date.now());
  $effect(() => {
    if (!$signInCode$) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  const signInCodeRemainingMs = $derived(
    $signInCode$ ? Math.max(0, $signInCode$.expiresAt - now) : 0,
  );

  // Bound to the Switch rather than derived: the Switch owns its checked state
  // once clicked, so a rejected change must be pushed back into it explicitly.
  let toggleOn = $state(false);
  let portInput = $state<number | null>(null);
  let portError = $state('');

  $effect(() => {
    if (!$busy$) {
      toggleOn = $access$?.enabled ?? false;
      portInput = null;
    }
  });

  onMount(() => {
    appStore.dispatch(loadBrowserAccessRequested());
  });

  function handleToggle(checked: boolean): void {
    toggleOn = checked;
    appStore.dispatch(setBrowserAccessEnabledRequested(checked));
  }

  function commitPort(): void {
    const current = $access$;
    if (portInput === null || !current || portInput === current.port) {
      portInput = null;
      return;
    }
    if (!isValidBrowserAccessPort(portInput)) {
      portError = m.settings_browserAccess_port_invalid({
        min: BROWSER_ACCESS_MIN_PORT,
        max: BROWSER_ACCESS_MAX_PORT,
      });
      return;
    }
    appStore.dispatch(setBrowserAccessPortRequested(portInput));
  }

  const startError = $derived.by(() => {
    const current = $access$;
    if (!current?.enabled || current.running || !current.error) return undefined;
    if (current.error === 'port-in-use') {
      return m.settings_browserAccess_portInUse_error({ port: current.port });
    }
    if (current.error === 'unavailable') return m.settings_browserAccess_unavailable_description();
    return m.settings_browserAccess_startFailed_error({ port: current.port });
  });

  const schema = $derived.by(() => {
    const current = $access$;
    const busy = $busy$;
    const failed = $failed$;
    const entries: SettingEntry[] = [
      {
        kind: 'switch',
        id: 'browser-access-enabled',
        label: m.settings_browserAccess_toggle_label(),
        get: () => toggleOn,
        set: handleToggle,
        disabled: () => !current || (!current.available && !current.enabled) || busy,
        error: () => (failed ? m.settings_browserAccess_saveError() : startError),
      },
    ];
    if (current?.enabled) {
      entries.push(
        {
          kind: 'number',
          id: 'browser-access-port',
          label: m.settings_browserAccess_port_label(),
          min: BROWSER_ACCESS_MIN_PORT,
          max: BROWSER_ACCESS_MAX_PORT,
          step: 1,
          disabled: () => busy,
          get: () => portInput ?? current.port,
          set: (value: number) => {
            portInput = value;
            portError = '';
          },
          onBlur: commitPort,
          error: () => portError || undefined,
        },
        {
          kind: 'custom',
          id: 'browser-access-key',
          label: m.settings_browserAccess_accessKey_label(),
          description: m.settings_browserAccess_accessKey_description(),
          layout: 'full-width',
        },
        ...(current.running
          ? [
              {
                kind: 'action',
                id: 'browser-access-sign-in-link',
                label: m.settings_browserAccess_signInLink_label(),
                description: m.settings_browserAccess_signInLink_description(),
                actionLabel: m.settings_browserAccess_createSignInLink_label(),
                variant: 'outline',
                disabled: () => busy,
                error: () =>
                  $signInCodeFailed$ ? m.settings_browserAccess_signInCode_error() : undefined,
                action: () => {
                  appStore.dispatch(createBrowserAccessSignInCodeRequested());
                },
              } satisfies SettingEntry,
            ]
          : []),
        ...($signInCode$ && current.running
          ? [
              {
                kind: 'custom',
                id: 'browser-access-sign-in-code',
                label: m.settings_browserAccess_signInCode_label(),
                layout: 'full-width',
              } satisfies SettingEntry,
            ]
          : []),
        {
          kind: 'action',
          id: 'browser-access-reset-key',
          label: m.settings_browserAccess_resetKey_label(),
          actionLabel: m.settings_browserAccess_resetKey_label(),
          variant: 'outline',
          disabled: () => busy,
          action: () => {
            appStore.dispatch(resetBrowserAccessKeyRequested());
          },
        },
      );
    }
    return defineSettings({
      sections: [
        { id: 'browser-access-settings', title: m.settings_section_browserAccess(), entries },
      ],
    });
  });
</script>

{#snippet toggleDescription()}
  <span class="block">{m.settings_browserAccess_description()}</span>
  {#if $access$ && !$access$.available}
    <span class="block">{m.settings_browserAccess_unavailable_description()}</span>
  {:else if $access$?.running}
    <span class="block text-success">
      {m.settings_browserAccess_running_description({
        // i18n-ignore (loopback address, not prose)
        address: `127.0.0.1:${$access$.port}`,
      })}
    </span>
  {/if}
{/snippet}

{#snippet keyControl()}
  {#if $access$}
    <CopyInput
      value={$access$.accessKey}
      label={m.settings_browserAccess_accessKey_label()}
      data-testid="browser-access-key"
    />
  {/if}
{/snippet}

{#snippet signInCodeControl()}
  {#if $signInCode$}
    <div class="flex flex-col gap-2" data-testid="browser-access-sign-in-code">
      <CopyInput
        value={$signInCode$.code}
        label={m.settings_browserAccess_signInCode_label()}
        data-testid="browser-access-sign-in-code-value"
      />
      {#if $signInCode$.link}
        <CopyInput
          value={$signInCode$.link}
          label={m.settings_browserAccess_signInLink_label()}
          data-testid="browser-access-sign-in-link"
        />
      {:else}
        <span class="type-body text-muted-foreground">
          {m.settings_browserAccess_signInCodeNoLink_description()}
        </span>
      {/if}
      <span
        class="type-body text-muted-foreground"
        role="status"
        data-testid="browser-access-sign-in-code-expiry"
      >
        {signInCodeRemainingMs > 0
          ? m.settings_browserAccess_signInCodeExpires_description({
              time: formatCompactDuration(signInCodeRemainingMs),
            })
          : m.settings_browserAccess_signInCodeExpired_description()}
      </span>
    </div>
  {/if}
{/snippet}

<SettingsForm
  {schema}
  embedded
  compact={false}
  descriptions={{ 'browser-access-enabled': toggleDescription }}
  custom={defineSettingsCustomControls({
    'browser-access-key': keyControl,
    'browser-access-sign-in-code': signInCodeControl,
  })}
/>
