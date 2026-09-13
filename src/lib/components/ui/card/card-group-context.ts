import { getContext, setContext } from 'svelte';

const key = Symbol('card-group');
export interface CardGroupContext {
  readonly orientation: 'card' | 'inline';
  readonly border: 'none' | 'outlined';
  readonly separated: boolean;
}
export const setCardGroup = (value: CardGroupContext) => setContext(key, value);
export const getCardGroup = () => getContext<CardGroupContext | undefined>(key);
