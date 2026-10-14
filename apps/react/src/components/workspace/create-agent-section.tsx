import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { SidebarHeaderAction } from './sidebar/sidebar-header-action';
import { faPlus } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';

interface CreateAgentSectionProps {
  onCreate?: () => void;
  onCreateWithSpecialist?: (specialistId: string | null) => void;
  compact?: boolean;
}

export function CreateAgentSection({
  onCreate,
  onCreateWithSpecialist,
  compact = false,
}: CreateAgentSectionProps) {
  function handleCreateAgent() {
    if (onCreate) {
      onCreate();
    } else {
      onCreateWithSpecialist?.(null);
    }
  }

  if (compact) {
    return (
      <SidebarHeaderAction
        icon="plus"
        label={m.workspace_createAgentSection_createNewAgent_label()}
        onClick={handleCreateAgent}
      />
    );
  }

  return (
    <div className="w-full pb-2 -mt-1">
      <Button
        variant="ghost-light"
        size="xs"
        className="w-full px-0! justify-start gap-1.5 font-normal text-sm"
        onClick={handleCreateAgent}
      >
        <IconDefinitionIcon icon={faPlus} size="0.75em" className="opacity-60 mr-1.25 ml-2.75" />
        {m.workspace_createAgentSection_createNewAgent_label()}
      </Button>
    </div>
  );
}
