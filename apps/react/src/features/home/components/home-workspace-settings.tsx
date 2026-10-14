import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { faChevronDown } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import type { HomeWorkspacesState } from '../../../../../../src/features/home/home-workspaces-slice';

interface HomeWorkspaceSettingsProps {
  view: HomeWorkspacesState;
  onChange: (changes: Partial<HomeWorkspacesState>) => void;
}

export function HomeWorkspaceSettings({ view, onChange }: HomeWorkspaceSettingsProps) {
  const dateOptions = [
    { value: 'all', label: m.home_updated_anytime() },
    { value: 'day', label: m.home_updated_day() },
    { value: 'week', label: m.home_updated_week() },
    { value: 'month', label: m.home_updated_month() },
  ];
  const groupingOptions = [
    { value: 'status', label: m.layout_allCard_status_label() },
    { value: 'repository', label: m.home_repository() },
    { value: 'none', label: m.settings_mcp_form_auth_none() },
  ];
  return (
    <>
      <div className="shrink-0">
        <Select
          value={view.updatedWithin ?? 'all'}
          onValueChange={(value) => {
            if (value === 'all' || value === 'day' || value === 'week' || value === 'month')
              onChange({ updatedWithin: value, selectedId: null });
          }}
        >
          <SelectTrigger
            variant="ghost"
            className="h-9 w-auto shrink-0 gap-2 rounded-full bg-muted/50 px-3"
            aria-label={m.home_updated_filter()}
          >
            <span className="text-muted-foreground">{m.home_updated_filter()}</span>
            <span>
              {dateOptions.find((option) => option.value === (view.updatedWithin ?? 'all'))?.label}
            </span>
            <IconDefinitionIcon icon={faChevronDown} className="text-muted-foreground" />
          </SelectTrigger>
          <SelectContent portal>
            {dateOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="shrink-0">
        <Select
          value={view.groupBy}
          onValueChange={(value) => {
            if (value === 'status' || value === 'repository' || value === 'none')
              onChange({ groupBy: value });
          }}
        >
          <SelectTrigger
            variant="ghost"
            className="h-9 w-auto shrink-0 gap-2 rounded-full bg-muted/50 px-3"
            aria-label={m.layout_sidebarPanel_groupBy_label()}
          >
            <span className="text-muted-foreground">{m.layout_sidebarPanel_groupBy_label()}</span>
            <span>{groupingOptions.find((option) => option.value === view.groupBy)?.label}</span>
            <IconDefinitionIcon icon={faChevronDown} className="text-muted-foreground" />
          </SelectTrigger>
          <SelectContent portal>
            {groupingOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
