<script lang="ts">
  import StreamingStatus from '../StreamingStatus.svelte';

  interface Props {
    theme?: 'light' | 'dark';
  }

  let { theme = 'light' }: Props = $props();

  const quotaExceeded = {
    providerId: 'claude-code@work',
    displayName: 'Anthropic Claude Code · someone-with-a-long-address@example.com',
  };
  const noop = () => {};

  $effect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains('light');
    const hadDark = root.classList.contains('dark');
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    return () => {
      root.classList.toggle('light', hadLight);
      root.classList.toggle('dark', hadDark);
    };
  });
</script>

<section class="flex w-[420px] flex-col gap-6 bg-background p-6 text-foreground">
  <div data-testid="quota-with-alternative">
    <StreamingStatus
      error="You've hit your usage limit"
      {quotaExceeded}
      quotaRetryProviders={[{ id: 'codex', displayName: 'OpenAI Codex' }]}
      onRetry={noop}
      onRetryWithProvider={noop}
    />
  </div>
  <div data-testid="quota-reset-only">
    <StreamingStatus
      error="You've hit your usage limit"
      {quotaExceeded}
      quotaRetryProviders={[]}
      onRetry={noop}
      onRetryWithProvider={noop}
    />
  </div>
</section>
