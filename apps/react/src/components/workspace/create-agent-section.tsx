import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { SidebarHeaderAction } from './sidebar/sidebar-header-action';
import { faPlus } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';

interface CreateAgentSectionProps {
  onCreate?: () => void;
  onCreateWithSpecialist?: (specialistId: string | null) => void;
  compact?: boolean;
  disabled?: boolean;
  pending?: boolean;
}

export function CreateAgentSection({
  onCreate,
  onCreateWithSpecialist,
  compact = false,
  disabled = false,
  pending = false,
}: CreateAgentSectionProps) {
  function handleCreateAgent() {
    if (disabled || pending) return;
    if (onCreate) {
      onCreate();
    } else {
      onCreateWithSpecialist?.(null);
    }
  }

  if (compact) {
    return (
      <SidebarHeaderAction
        disabled={disabled || pending}
        icon="plus"
        label={
          pending
            ? m.workspace_modals_creating_label()
            : m.workspace_createAgentSection_createNewAgent_label()
        }
        onClick={handleCreateAgent}
      />
    );
  }

  return (
    <div className="w-full pb-2 -mt-1">
      <Button
        disabled={disabled || pending}
        loading={pending}
        variant="ghost-light"
        size="xs"
        className="w-full px-0! justify-start gap-1.5 font-normal text-sm"
        onClick={handleCreateAgent}
      >
        <IconDefinitionIcon icon={faPlus} size="0.75em" className="opacity-60 mr-1.25 ml-2.75" />
        {pending
          ? m.workspace_modals_creating_label()
          : m.workspace_createAgentSection_createNewAgent_label()}
      </Button>
    </div>
  );
}
