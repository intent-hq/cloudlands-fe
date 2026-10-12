// Source: src/lib/components/chat/DetectedScriptsCard.svelte.
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faWandMagicSparkles } from '$lib/icons/phosphor-icon-definitions';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';

export interface DetectedScript {
  name: string;
  command: string;
  mode: string;
  category?: string;
}

export interface DetectedScriptsCardProps {
  scripts: DetectedScript[];
}

export type Props = DetectedScriptsCardProps;

export function DetectedScriptsCard({ scripts }: DetectedScriptsCardProps) {
  return (
    <div className="detected-scripts-card my-3 rounded-lg border border-border bg-muted/30 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
        <IconDefinitionIcon
          icon={faWandMagicSparkles}
          size="0.875em"
          className="text-primary-ink/70"
        />
        <span className="text-sm font-semibold text-foreground">
          {m.chat_detectedScripts_title()}
        </span>
      </div>

      <div className="divide-y divide-border">
        {scripts.map((script) => (
          <div key={script.name + script.command} className="flex items-start gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">{script.name}</span>
                {script.mode === 'service' ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-script-service/15 text-script-service-foreground">
                    {m.chat_detectedScripts_service_badge()}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                    {m.chat_detectedScripts_command_badge()}
                  </span>
                )}
                {script.category && script.category !== 'other' ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary/80">
                    {script.category}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 text-xs font-mono text-muted-foreground truncate">
                {script.command}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-border bg-muted/20">
        <span className="text-xs text-muted-foreground">
          {scripts.length === 1
            ? m.chat_detectedScripts_count_one({ count: formatInteger(scripts.length) })
            : m.chat_detectedScripts_count_many({ count: formatInteger(scripts.length) })}
        </span>
      </div>
    </div>
  );
}

export default DetectedScriptsCard;
