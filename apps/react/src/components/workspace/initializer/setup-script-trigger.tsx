import { useId } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { m } from '$shared/paraglide/messages.js';

export interface SetupScriptTriggerProps {
  value: string;
  loading?: boolean;
  expanded?: boolean;
  onOpen: () => void;
}

export function SetupScriptTrigger({
  value,
  loading = false,
  expanded = false,
  onOpen,
}: SetupScriptTriggerProps) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{m.workspace_setupScriptEditor_setupScript_label()}</Label>
      <Button
        id={id}
        type="button"
        variant="outline"
        className="w-full min-w-0 justify-between gap-2 text-left font-normal"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        onClick={onOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          {loading ? (
            <>
              <IntentMarkLoader size={14} />
              <span className="truncate">
                {m.workspace_compactInitializer_detectingSetupScript_label()}
              </span>
            </>
          ) : (
            <span className="truncate">{value}</span>
          )}
        </span>
        <CaretRightIcon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
    </div>
  );
}
