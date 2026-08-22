/**
 * Fleet HUD feature — public surface for the /hud route.
 *
 * `startHudSubscription()` boots the data layer (global events.subscribe +
 * usage/system rollups) and returns the disposer the route calls on unmount.
 */
export { startHudSubscription } from './hud-subscription';
