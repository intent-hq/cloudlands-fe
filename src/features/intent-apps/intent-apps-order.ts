/**
 * Library order: apps that need approval first (an agent installed them, or
 * their bundle changed), then the rest in the daemon's `app.list` order.
 */
import { isIntentAppOpenable, type IntentApp } from '$shared/intent-apps/intent-apps-types';

/** Installed and not approved for its bundle; a removed approval is the user's choice, not a request. */
export function needsIntentAppApproval(app: IntentApp): boolean {
  return !isIntentAppOpenable(app) && app.approval.status !== 'revoked';
}

export function orderIntentApps(apps: readonly IntentApp[]): IntentApp[] {
  return [
    ...apps.filter((app) => needsIntentAppApproval(app)),
    ...apps.filter((app) => !needsIntentAppApproval(app)),
  ];
}
