import Content from './tabs-content.svelte';
import List from './tabs-list.svelte';
import Root from './tabs.svelte';
import Trigger from './tabs-trigger.svelte';

export type { TabsVariant } from './context';
export { tabsMetadata } from './tabs.meta';
export {
  Content,
  Content as TabsContent,
  List,
  List as TabsList,
  Root,
  Root as Tabs,
  Trigger,
  Trigger as TabsTrigger,
};
