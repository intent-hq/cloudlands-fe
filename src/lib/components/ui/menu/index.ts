import { DropdownMenu as MenuPrimitive } from 'bits-ui';
import Root from './menu.svelte';
import Trigger from './menu-trigger.svelte';
import Content from './menu-content.svelte';
import Item from './menu-item.svelte';
import CheckboxItem from './menu-checkbox-item.svelte';
import RadioItem from './menu-radio-item.svelte';
import SubTrigger from './menu-sub-trigger.svelte';
import SubContent from './menu-sub-content.svelte';
import Separator from './menu-separator.svelte';

const Portal = MenuPrimitive.Portal;
const CheckboxGroup = MenuPrimitive.CheckboxGroup;
const RadioGroup = MenuPrimitive.RadioGroup;
const Sub = MenuPrimitive.Sub;
export { menuFixtures } from './menu.fixtures';
export { menuMetadata, menuSemantics } from './menu.meta';

export {
  Root,
  Trigger,
  Portal,
  Content,
  Item,
  CheckboxGroup,
  CheckboxItem,
  RadioGroup,
  RadioItem,
  Sub,
  SubTrigger,
  SubContent,
  Separator,
  Root as Menu,
  Trigger as MenuTrigger,
  Portal as MenuPortal,
  Content as MenuContent,
  Item as MenuItem,
  CheckboxGroup as MenuCheckboxGroup,
  CheckboxItem as MenuCheckboxItem,
  RadioGroup as MenuRadioGroup,
  RadioItem as MenuRadioItem,
  Sub as MenuSub,
  SubTrigger as MenuSubTrigger,
  SubContent as MenuSubContent,
  Separator as MenuSeparator,
};
