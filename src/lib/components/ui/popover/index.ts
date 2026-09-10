import { Popover as PopoverPrimitive } from 'bits-ui';
import Root from './popover-root.svelte';
import Content from './popover-content.svelte';

const Trigger = PopoverPrimitive.Trigger;
const Close = PopoverPrimitive.Close;
const Portal = PopoverPrimitive.Portal;
const Arrow = PopoverPrimitive.Arrow;

export { Root, Trigger, Content, Close, Portal, Arrow };
