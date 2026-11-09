/**
 * Display helpers for cloud machines: sandbox names and groups, sizes,
 * uptime, hourly cost and the three cloud error codes in the app's words.
 */
import { m } from '$shared/paraglide/messages.js';
import {
  CLOUD_ENTRY_NAME_MAX_BYTES,
  cloudSizeResources,
  estimateCloudCost,
  utf8Length,
  type CloudMachineErrorData,
} from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';

/** The E2B project dashboard, where the owner manages plan limits and spend. */
export const E2B_DASHBOARD_URL = 'https://e2b.dev/dashboard';

const NAME_PREFIX = /^E2B\s*·\s*/u; // i18n-ignore (backend row name prefix)

/** The agent a sandbox runs, from its row name "<entry name> · <agent name>". */
export function sandboxLabel(machine: Pick<RemoteMachine, 'name'>, entryName?: string): string {
  const prefix = entryName ? `${entryName} · ` : null; // i18n-ignore (backend row name format)
  const name =
    prefix && machine.name.startsWith(prefix)
      ? machine.name.slice(prefix.length)
      : machine.name.replace(NAME_PREFIX, '');
  return name.trim() || machine.name;
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

/** "About $0.33 per running hour" for a size; null for an unknown size. */
export function hourlyCostLabel(size: string): string | null {
  const hourly = estimateCloudCost(size, 3600);
  return hourly === null ? null : m.cloudMachines_size_hourly({ amount: usd.format(hourly) });
}

/** Sandboxes of one workspace; `key` is the workspace id, or "" for Other. */
export interface SandboxGroup {
  key: string;
  name: string;
  sandboxes: RemoteMachine[];
}

/**
 * Sandboxes by workspace, groups by name with Other last, newest start first
 * in each. A sandbox goes to Other when this app has no name for its workspace.
 */
export function groupSandboxesByWorkspace(
  sandboxes: readonly RemoteMachine[],
  workspaceName: (workspaceId: string) => string | null,
): SandboxGroup[] {
  const groups = new Map<string, SandboxGroup>();
  for (const machine of sandboxes) {
    const id = machine.cloud?.workspaceId;
    const name = id ? workspaceName(id) : null;
    const key = id && name ? id : '';
    let group = groups.get(key);
    if (!group) {
      group = { key, name: name ?? m.cloudMachines_sandboxes_otherWorkspace(), sandboxes: [] };
      groups.set(key, group);
    }
    group.sandboxes.push(machine);
  }
  for (const group of groups.values())
    group.sandboxes.sort(
      (a, b) =>
        (b.cloud?.startedAt ?? '').localeCompare(a.cloud?.startedAt ?? '') ||
        a.id.localeCompare(b.id),
    );
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.key === '') - Number(b.key === '') ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.key.localeCompare(b.key),
  );
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

/**
 * Why `name` can't name an entry, or null when it can: 1-64 UTF-8 bytes after
 * trimming, no control characters, and unique among the other entries
 * regardless of case (PROTOCOL "Named E2B entries"). The backend checks again.
 */
export function cloudEntryNameError(
  name: string,
  entries: readonly { id: string; name: string }[],
  selfId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return m.cloudMachines_form_name_required();
  if (utf8Length(trimmed) > CLOUD_ENTRY_NAME_MAX_BYTES || /[\u0000-\u001f\u007f]/u.test(trimmed))
    return m.cloudMachines_form_name_invalid();
  const lower = trimmed.toLowerCase();
  return entries.some((entry) => entry.id !== selfId && entry.name.trim().toLowerCase() === lower)
    ? m.cloudMachines_form_name_taken()
    : null;
}
