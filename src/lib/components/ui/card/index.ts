import Root from './card.svelte';
import Group from './card-group.svelte';
import Content from './card-content.svelte';
import Description from './card-description.svelte';
import Footer from './card-footer.svelte';
import Header from './card-header.svelte';
import Title from './card-title.svelte';
import Action from './card-action.svelte';

export { cardMetadata } from './card.meta';
export { CARD_CONTENT_INSET_CLASS, CARD_ROW_GUTTER_CLASS } from './card-inset';

export {
  Root,
  Group,
  Group as CardGroup,
  Content,
  Description,
  Footer,
  Header,
  Title,
  Action,
  //
  Root as Card,
  Content as CardContent,
  Description as CardDescription,
  Footer as CardFooter,
  Header as CardHeader,
  Title as CardTitle,
  Action as CardAction,
};
