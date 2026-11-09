/**
 * How an E2B start failure reads in the chat's failure card (PROTOCOL
 * `methods/nodes.md` "Remote machine errors"): a plain title and cause, the
 * actions most likely to help (primary first), and the technical detail for
 * the Details disclosure.
 */
import { m } from '$shared/paraglide/messages.js';
import type { CloudMachineErrorData } from '$shared/types/cloud-machines';
import type { PlacementFailure } from './agent-location';

export type CloudStartFailureAction = 'retry' | 'settings';

export interface CloudStartFailureView {
  /** `danger` when Retry may work; `warning` when the user must change something first. */
  tone: 'danger' | 'warning';
  title: string;
  cause: string;
  /** Offered actions, primary first. Retry is dropped when the caller can't retry. */
  actions: CloudStartFailureAction[];
  /** The E2B dashboard helps (plan limits, the API key). */
  dashboard: boolean;
  details: string;
}

type Copy = Omit<CloudStartFailureView, 'details'>;

const startFailed = (cause: string): Copy => ({
  tone: 'danger',
  title: m.cloudMachines_startFailure_title(),
  cause,
  actions: ['retry', 'settings'],
  dashboard: false,
});

function copy(failure: PlacementFailure, cloud: CloudMachineErrorData): Copy {
  switch (cloud.code) {
    case 'cloud-profile-required':
      return {
        tone: 'warning',
        title: m.cloudMachines_error_profileRequired_title(),
        cause: m.cloudMachines_error_profileRequired_description(),
        actions: ['settings'],
        dashboard: false,
      };
    case 'cloud-quota':
      if (cloud.limit === 'rate')
        return {
          ...startFailed(m.cloudMachines_error_quotaRate_description()),
          title: m.cloudMachines_startFailure_busy_title(),
        };
      return {
        tone: 'warning',
        title: m.cloudMachines_startFailure_quota_title(),
        cause:
          cloud.limit === 'plan'
            ? m.cloudMachines_startFailure_quotaPlan_cause()
            : m.cloudMachines_startFailure_quotaConcurrency_cause(),
        actions: cloud.limit === 'plan' ? ['settings'] : ['settings', 'retry'],
        dashboard: true,
      };
    case 'cloud-machine-unavailable':
      if (!failure.cloudDetailKnown)
        return startFailed(m.cloudMachines_startFailure_unknown_cause());
      switch (cloud.reason) {
        case 'bootstrap-failed':
          return startFailed(m.cloudMachines_startFailure_bootstrap_cause());
        case 'sandbox-lost':
          return {
            ...startFailed(m.cloudMachines_startFailure_sandboxLost_cause()),
            title: m.cloudMachines_error_sandboxLost_title(),
          };
        case 'template-missing':
          return {
            tone: 'warning',
            title: m.cloudMachines_startFailure_templateMissing_title(),
            cause: m.cloudMachines_startFailure_templateMissing_cause(),
            actions: ['settings'],
            dashboard: false,
          };
        case 'key-rejected':
          return {
            tone: 'warning',
            title: m.cloudMachines_error_keyRejected_title(),
            cause: m.cloudMachines_startFailure_keyRejected_cause(),
            actions: ['settings'],
            dashboard: true,
          };
        case 'not-configured':
          return {
            tone: 'warning',
            title: m.cloudMachines_startFailure_notConfigured_title(),
            cause: m.cloudMachines_error_notConfigured_description(),
            actions: ['settings'],
            dashboard: false,
          };
        default:
          return startFailed(m.cloudMachines_startFailure_apiError_cause());
      }
  }
}

/** The error code, its reason or limit, and the backend's own words. */
function details(
  failure: PlacementFailure,
  cloud: CloudMachineErrorData,
  turnError?: string | null,
): string {
  const head = [
    cloud.code,
    cloud.code === 'cloud-machine-unavailable' && failure.cloudDetailKnown ? cloud.reason : null,
    cloud.code === 'cloud-quota' ? cloud.limit : null,
    cloud.code === 'cloud-machine-unavailable' && cloud.status ? `HTTP ${cloud.status}` : null, // i18n-ignore (protocol detail)
  ]
    .filter(Boolean)
    .join(' · ');
  const message = failure.message.trim();
  const lines = [head, message];
  const extra = turnError?.trim();
  if (extra && (!message || (!message.includes(extra) && !extra.includes(message))))
    lines.push(extra);
  return lines.filter(Boolean).join('\n');
}

/** Null when the failure carries no cloud error. */
export function cloudStartFailureView(
  failure: PlacementFailure,
  options: { canRetry: boolean; turnError?: string | null },
): CloudStartFailureView | null {
  const cloud = failure.cloud;
  if (!cloud) return null;
  const view = copy(failure, cloud);
  return {
    ...view,
    actions: options.canRetry ? view.actions : view.actions.filter((a) => a !== 'retry'),
    details: details(failure, cloud, options.turnError),
  };
}
