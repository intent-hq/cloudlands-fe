import Root from './select.svelte';
import Trigger from './select-trigger.svelte';
import Value from './select-value.svelte';
import Content from './select-content.svelte';
import Item from './select-item.svelte';

// Export individual components
export {
  Root as SelectRoot,
  Trigger as SelectTrigger,
  Value as SelectValue,
  Content as SelectContent,
  Item as SelectItem,
};

// Export as namespace for backward compatibility
export const Select = {
  Root,
  Trigger,
  Value,
  Content,
  Item,
};
