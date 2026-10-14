import * as Menu from '@/components/ui/menu';
import { AgentAvatar } from '@/features/agent/components/agent-avatar/agent-avatar';
import type { Specialist } from '$lib/constants/specialists';
import { m } from '$shared/paraglide/messages.js';

interface SpecialistOptionsProps {
  specialists: readonly Specialist[];
  value?: string | null;
  onChange: (id: string | null) => void;
}
export function SpecialistOptions({ specialists, value = null, onChange }: SpecialistOptionsProps) {
  const options = [
    {
      id: null,
      name: m.chat_shared_general_fallback(),
      description: m.chat_shared_noSpecializedBehavior_label(),
      icon: undefined,
    },
    ...specialists,
  ];
  return (
    <Menu.RadioGroup
      value={value === null ? 'general' : `specialist:${value}`}
      aria-label={m.workspace_createAgentSection_specialists_label()}
    >
      {options.map((option) => (
        <Menu.RadioItem
          key={option.id === null ? 'general' : `specialist:${option.id}`}
          value={option.id === null ? 'general' : `specialist:${option.id}`}
          closeOnSelect
          className="h-auto min-h-(--control-height-medium) gap-2 py-2 whitespace-normal"
          data-specialist-option={option.id ?? 'general'}
          onSelect={() => onChange(option.id)}
        >
          <AgentAvatar
            agentId="blank"
            variant="standard"
            specialist={option.id}
            icon={option.icon}
          />
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className="type-caption truncate text-foreground">{option.name}</span>
            <span className="type-caption line-clamp-2 text-muted-foreground">
              {option.description}
            </span>
          </span>
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}
