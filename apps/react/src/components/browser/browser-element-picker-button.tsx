import { faCrosshairs } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';

export interface BrowserElementPickerButtonProps {
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}

export function BrowserElementPickerButton({
  active,
  disabled,
  onToggle,
}: BrowserElementPickerButtonProps) {
  return (
    <Button
      variant="ghost-light"
      size="icon-xs"
      className={active ? 'bg-muted text-foreground' : ''}
      onClick={onToggle}
      disabled={disabled}
      tooltip={
        active
          ? m.browser_embedded_cancelElementSelection_tooltip()
          : m.browser_embedded_selectElement_tooltip()
      }
      tooltipSide="bottom"
      aria-label={
        active
          ? m.browser_embedded_cancelElementSelection_ariaLabel()
          : m.browser_embedded_selectElement_ariaLabel()
      }
      aria-pressed={active}
      data-testid="browser-select-element"
    >
      <IconDefinitionIcon icon={faCrosshairs} size="0.75em" />
    </Button>
  );
}
