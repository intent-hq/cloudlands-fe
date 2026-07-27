<script lang="ts">
  import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface DetectedScript {
    name: string;
    command: string;
    mode: string;
    category?: string;
  }

  interface Props {
    scripts: DetectedScript[];
  }

  let { scripts }: Props = $props();
</script>

<div class="detected-scripts-card my-3 rounded-lg border border-border bg-muted/30 overflow-hidden">
  <!-- Header -->
  <div class="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/40">
    <Fa icon={faWandMagicSparkles} size="sm" class="text-primary/70" />
    <span class="text-sm font-semibold text-foreground">{m.chat_detectedScripts_title()}</span>
  </div>

  <!-- Script list -->
  <div class="divide-y divide-border/30">
    {#each scripts as script (script.name + script.command)}
      <div class="flex items-start gap-3 px-4 py-2.5">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-semibold text-foreground">{script.name}</span>
            <!-- Mode badge -->
            {#if script.mode === 'service'}
              <span
                class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400"
              >
                {m.chat_detectedScripts_service_badge()}
              </span>
            {:else}
              <span
                class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground"
              >
                {m.chat_detectedScripts_command_badge()}
              </span>
            {/if}
            <!-- Category badge -->
            {#if script.category && script.category !== 'other'}
              <span
                class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary/80"
              >
                {script.category}
              </span>
            {/if}
          </div>
          <div class="mt-0.5 text-xs font-mono text-muted-foreground truncate">
            {script.command}
          </div>
        </div>
      </div>
    {/each}
  </div>

  <!-- Footer -->
  <div class="px-4 py-2 border-t border-border/50 bg-muted/20">
    <span class="text-xs text-muted-foreground">
      {scripts.length === 1
        ? m.chat_detectedScripts_count_one({ count: formatInteger(scripts.length) })
        : m.chat_detectedScripts_count_many({ count: formatInteger(scripts.length) })}
    </span>
  </div>
</div>

