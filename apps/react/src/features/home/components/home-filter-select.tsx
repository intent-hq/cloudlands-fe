import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faChevronDown } from '$lib/icons/phosphor-icon-definitions';
import './home-controls.css';

interface HomeFilterSelectProps {
  value: string;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
  onchange: (value: string) => void;
}

export function HomeFilterSelect({
  value,
  options,
  label,
  disabled = false,
  onchange,
}: HomeFilterSelectProps) {
  return (
    <Select value={value} onValueChange={onchange} disabled={disabled}>
      <SelectTrigger
        variant="ghost"
        className="home-control-fill h-9 max-w-full gap-2 rounded-xl px-3"
        aria-label={label}
      >
        <span className="truncate">{options.find((option) => option.value === value)?.label}</span>
        <IconDefinitionIcon icon={faChevronDown} className="shrink-0 text-muted-foreground" />
      </SelectTrigger>
      <SelectContent portal align="center" className="w-max min-w-48">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} label={option.label}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
