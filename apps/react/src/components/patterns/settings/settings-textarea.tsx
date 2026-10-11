// Source: src/lib/components/patterns/settings/SettingsTextarea.svelte.
// The forwarded native textarea ref supplies both focus() and blur().
import { Textarea, type TextareaProps } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type SettingsTextareaProps = TextareaProps;
export function SettingsTextarea({ className, ...props }: SettingsTextareaProps) {
  return (
    <Textarea
      {...props}
      className={cn(
        className,
        'bg-card hover:bg-card data-[state=hover]:bg-card focus-visible:!bg-card disabled:bg-card disabled:hover:bg-card',
      )}
    />
  );
}
