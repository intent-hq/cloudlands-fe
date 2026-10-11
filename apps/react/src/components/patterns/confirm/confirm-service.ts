// Reuse the canonical framework-neutral queue, promise resolution and invocation focus.
export {
  alert,
  confirm,
  prompt,
  settleConfirmRequest,
  subscribeConfirmRequests,
  type ConfirmRequest,
} from '$lib/components/patterns/confirm/confirm-service';
