/**
 * Display helpers for cloud machines: sandbox names, sizes, uptime, cost
 * estimates and the three cloud error codes in the app's words.
 */
import { m } from '$shared/paraglide/messages.js';
import {
  cloudSizeResources,
  estimateCloudCost,
  type CloudMachineErrorData,
} from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';

/** The E2B project dashboard, where the owner manages plan limits and spend. */
export const E2B_DASHBOARD_URL = 'https://e2b.dev/dashboard';

const NAME_PREFIX = /^E2B\s*·\s*/u; // i18n-ignore (backend row name prefix)

/** The agent a sandbox runs, from its row name "E2B · <agent name>". */
export function sandboxLabel(machine: Pick<RemoteMachine, 'name'>): string {
  return machine.name.replace(NAME_PREFIX, '').trim() || machine.name;
}

/** "intent-node 0.212.0" for "<project>/intent-node-4x8:0.212.0"; null without a tag. */
export function templateVersionLabel(template: string): string | null {
  const version = template.split(':')[1];
  return version ? m.cloudMachines_row_template({ version }) : null;
}

/** "4 vCPU · 8 GiB" for a size id ("4x8"); the id itself when unknown. */
export function cloudSizeLabel(size: string): string {
  const resources = cloudSizeResources(size);
  return resources
    ? m.cloudMachines_size_label({
        vcpu: String(resources.vcpu),
        memory: String(resources.memoryGiB),
      })
    : size;
}

/** Seconds not paused since start, advanced by the time since the row was read while it runs. */
export function liveRunningSeconds(machine: RemoteMachine, readAt: number, now: number): number {
  const cloud = machine.cloud;
  if (!cloud) return 0;
  const since = cloud.state === 'running' && readAt > 0 ? Math.max(0, (now - readAt) / 1000) : 0;
  return Math.floor(cloud.runningSeconds + since);
}

/** "42 min", "1 h 12 min", "under 1 min". */
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return m.cloudMachines_uptime_underMinute();
  if (minutes < 60) return m.cloudMachines_uptime_minutes({ minutes: String(minutes) });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? m.cloudMachines_uptime_hours({ hours: String(hours) })
    : m.cloudMachines_uptime_hoursMinutes({ hours: String(hours), minutes: String(rest) });
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "≈ $0.19"; "< $0.01" for tiny amounts. */
export function formatCost(amount: number): string {
  if (amount > 0 && amount < 0.005) return m.cloudMachines_cost_tiny();
  return m.cloudMachines_cost_estimate({ amount: usd.format(amount) });
}

/** "About $0.33 per running hour" for a size; null for an unknown size. */
export function hourlyCostLabel(size: string): string | null {
  const hourly = estimateCloudCost(size, 3600);
  return hourly === null ? null : m.cloudMachines_size_hourly({ amount: usd.format(hourly) });
}

/** The sandbox's estimated cost so far; null for an unknown size. */
export function sandboxCost(machine: RemoteMachine, seconds: number): number | null {
  return machine.cloud ? estimateCloudCost(String(machine.cloud.size), seconds) : null;
}

/** Title and description of a cloud error, for notices and form errors. */
export function cloudErrorText(error: CloudMachineErrorData): {
  title: string;
  description: string;
} {
  switch (error.code) {
    case 'cloud-profile-required':
      return {
        title: m.cloudMachines_error_profileRequired_title(),
        description: m.cloudMachines_error_profileRequired_description(),
      };
    case 'cloud-quota':
      return {
        title: m.cloudMachines_error_quota_title(),
        description:
          error.limit === 'plan'
            ? m.cloudMachines_error_quotaPlan_description()
            : error.limit === 'rate'
              ? m.cloudMachines_error_quotaRate_description()
              : m.cloudMachines_error_quotaConcurrency_description(),
      };
    case 'cloud-machine-unavailable':
      switch (error.reason) {
        case 'not-configured':
          return {
            title: m.cloudMachines_error_unavailable_title(),
            description: m.cloudMachines_error_notConfigured_description(),
          };
        case 'key-rejected':
          return {
            title: m.cloudMachines_error_keyRejected_title(),
            description: m.cloudMachines_error_keyRejected_description(),
          };
        case 'template-missing':
          return {
            title: m.cloudMachines_error_unavailable_title(),
            description: m.cloudMachines_error_templateMissing_description(),
          };
        case 'sandbox-lost':
          return {
            title: m.cloudMachines_error_sandboxLost_title(),
            description: m.cloudMachines_error_sandboxLost_description(),
          };
        case 'bootstrap-failed':
          return {
            title: m.cloudMachines_error_unavailable_title(),
            description: m.cloudMachines_error_bootstrapFailed_description(),
          };
        default:
          return {
            title: m.cloudMachines_error_unavailable_title(),
            description: m.cloudMachines_error_apiError_description(),
          };
      }
  }
}
