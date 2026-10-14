import { ContentDialog } from '@/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';

interface RulesInspectorProps {
  rules: string | null;
  onClose: () => void;
}

export function RulesInspector({ rules, onClose }: RulesInspectorProps) {
  return (
    <ContentDialog
      open
      title={m.chat_rulesInspector_title()}
      closeLabel={m.chat_rulesInspector_close_ariaLabel()}
      size="wide"
      onClose={onClose}
    >
      {rules ? (
        <pre className="whitespace-pre-wrap break-words font-mono type-caption bg-muted/50 p-4 rounded-md">
          {rules}
        </pre>
      ) : (
        <p className="text-muted-foreground">{m.chat_rulesInspector_noRules_label()}</p>
      )}
    </ContentDialog>
  );
}
