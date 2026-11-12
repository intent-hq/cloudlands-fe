<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const LOCAL_INTENT_ADD_PREVIEW_STATES = [
    'searching',
    'empty',
    'list-failed',
    'ready',
    'one-intent',
    'not-accepting',
    'redeeming',
    'wrong-code',
    'locked',
    'expired',
    'code-format',
    'gone',
    'unreachable',
    'certificate',
    'refused',
    'remote-access-on',
    'unsupported',
    'busy',
    'save-failed',
    'unknown',
    'added',
  ] as const;
  export type LocalIntentAddPreviewState = (typeof LOCAL_INTENT_ADD_PREVIEW_STATES)[number];

  export const preview = definePreview<{ state: LocalIntentAddPreviewState }>({
    id: 'local-intent-add',
    title: 'Add machine → Intent on this computer',
    defaultState: 'ready',
    states: Object.fromEntries(
      LOCAL_INTENT_ADD_PREVIEW_STATES.map((state) => [state, { props: { state } }]),
    ),
    captureReadiness: { selector: '[data-testid="local-intent-add"]' },
  });
</script>

<script lang="ts">
  import LocalIntentAddForm from './LocalIntentAddForm.svelte';
  import type {
    LocalIntent,
    LocalRedeemError,
    LocalRedeemErrorCode,
  } from '$shared/types/local-pairing';

  let { state = 'ready' }: { state?: LocalIntentAddPreviewState } = $props();

  const INTENTS: LocalIntent[] = [
    {
      instanceId: 'b-dev',
      displayName: 'Intent (dev build)',
      dataDir: '/Users/me/src/intent/.dev/intentd-data',
      accepting: true,
    },
    {
      instanceId: 'b-beta',
      displayName: 'Intent Beta',
      dataDir: '/Users/me/Library/Application Support/intentd-beta',
      accepting: false,
    },
  ];
  const ERROR_CODES = [
    'locked',
    'expired',
    'code-format',
    'gone',
    'unreachable',
    'certificate',
    'refused',
    'remote-access-on',
    'unsupported',
    'busy',
    'save-failed',
    'unknown',
  ] as const satisfies readonly LocalRedeemErrorCode[];
  const errorFor = (value: LocalIntentAddPreviewState): LocalRedeemError | null =>
    value === 'wrong-code'
      ? { code: 'wrong-code', attemptsRemaining: 3 }
      : (ERROR_CODES as readonly string[]).includes(value)
        ? { code: value as LocalRedeemErrorCode }
        : null;
  const intents = $derived(
    state === 'searching' || state === 'list-failed'
      ? null
      : state === 'empty'
        ? []
        : state === 'one-intent'
          ? INTENTS.slice(0, 1)
          : INTENTS,
  );
  const typed = $derived(
    state === 'ready' || state === 'redeeming' ? 'KTP82M' : state === 'code-format' ? 'KTP82' : '',
  );
  const noop = () => {};
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground">
  {#key state}
    <LocalIntentAddForm
      phase={state === 'redeeming' ? 'redeeming' : state === 'added' ? 'added' : 'ready'}
      {intents}
      listFailed={state === 'list-failed'}
      selectedId={state === 'not-accepting' ? 'b-beta' : (intents?.[0]?.instanceId ?? null)}
      error={errorFor(state)}
      addedName={state === 'added' ? 'Intent (dev build)' : null}
      initialCode={typed}
      onPick={noop}
      onSubmit={noop}
      onCodeEdited={noop}
      onClose={noop}
    />
  {/key}
</div>
