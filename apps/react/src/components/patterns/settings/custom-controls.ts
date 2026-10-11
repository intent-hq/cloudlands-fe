/** Source: settings/custom-controls.ts. Primitive bridge for registered custom renderers. */
export { Button } from '@/components/ui/button';
export { Checkbox } from '@/components/ui/checkbox';
export { CopyButton } from '@/components/ui/copy-button';
export { FileInput } from '@/components/ui/file-input';
export { GrokLogo } from '@/components/ui/grok-logo';
export { Header } from '@/components/ui/header';
export { Input } from '@/components/ui/input';
export { IntentMarkLoader } from '@/components/ui/indicators';
export { Label } from '@/components/ui/label';
export * as Menu from '@/components/ui/menu';
export { PrincipalAvatar } from '@/components/ui/principal-avatar';
export { Skeleton } from '@/components/ui/skeleton';
export { Slider } from '@/components/ui/slider';
export { Switch } from '@/components/ui/switch';
export { SettingsTextarea as Textarea } from './settings-textarea';
export { Tooltip } from '@/components/ui/tooltip';

import {
  Select as SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from '@/components/ui/select';
import {
  Popover as PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
  PopoverAnchor,
} from '@/components/ui/popover';
import { ToggleGroup as ToggleGroupRoot, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Popover as PopoverPrimitive } from 'radix-ui';

// Preserve the source bridge's compound public names while using React event/children props.
export const Select = {
  Root: SelectRoot,
  Trigger: SelectTrigger,
  Value: SelectValue,
  Content: SelectContent,
  Item: SelectItem,
  Group: SelectGroup,
};
export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Content: PopoverContent,
  Close: PopoverClose,
  Anchor: PopoverAnchor,
  Portal: PopoverPrimitive.Portal,
  Arrow: PopoverPrimitive.Arrow,
};
export const ToggleGroup = { Root: ToggleGroupRoot, Item: ToggleGroupItem };
