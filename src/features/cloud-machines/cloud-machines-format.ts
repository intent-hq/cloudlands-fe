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
  type Agent37InstanceType,
  type Agent37Region,
  type CloudMachineErrorData,
  type CloudProviderKind,
} from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';

/** The E2B project dashboard, where the owner manages plan limits and spend. */
const E2B_DASHBOARD_URL = 'https://e2b.dev/dashboard';
/** The Northflank dashboard, where the owner manages projects, tokens and limits. */
const NORTHFLANK_DASHBOARD_URL = 'https://app.northflank.com';
/** The Agent37 dashboard: keys, wallet, instances and templates. */
const AGENT37_DASHBOARD_URL = 'https://www.agent37.com/dashboard/cloud';

/** Vercel's dashboard: it opens the team last used, with its projects and tokens. */
const VERCEL_DASHBOARD_URL = 'https://vercel.com/dashboard';

export function cloudDashboardUrl(provider: CloudProviderKind = 'e2b'): string {
  if (provider === 'vercel') return VERCEL_DASHBOARD_URL;
  return provider === 'northflank'
    ? NORTHFLANK_DASHBOARD_URL
    : provider === 'agent37'
      ? AGENT37_DASHBOARD_URL
      : E2B_DASHBOARD_URL;
}

/**
 * A provider's own words for its machines: E2B and Vercel run sandboxes,
 * Northflank services, Agent37 instances.
 */
export function cloudProviderCopy(provider: CloudProviderKind) {
  switch (provider) {
    case 'northflank':
      return {
        keyRejected: m.cloudMachines_northflank_state_tokenRejected_label(),
        unreachable: m.cloudMachines_northflank_state_unreachable_label(),
        ownerOnly: m.cloudMachines_northflank_error_ownerOnly(),
        saved: m.cloudMachines_northflank_saved_toast(),
        listTitle: m.cloudMachines_northflank_services_title(),
        listSummary: m.cloudMachines_northflank_services_summary,
        dashboard: m.cloudMachines_northflank_dashboard_label(),
        dashboardOpen: m.cloudMachines_northflank_dashboardOpen_label(),
        deleteTitle: m.cloudMachines_northflank_delete_confirmTitle,
        deleteDescription: m.cloudMachines_northflank_delete_confirm_description(),
        creating: m.cloudMachines_northflank_start_creating(),
        startFailed: m.cloudMachines_northflank_startFailure_title(),
        startUnknown: m.cloudMachines_northflank_startFailure_unknown_cause(),
      };
    case 'agent37':
      return {
        keyRejected: m.cloudMachines_state_keyRejected_label(),
        unreachable: m.cloudMachines_agent37_state_unreachable_label(),
        ownerOnly: m.cloudMachines_agent37_error_ownerOnly(),
        saved: m.cloudMachines_agent37_saved_toast(),
        listTitle: m.cloudMachines_agent37_instances_title(),
        listSummary: m.cloudMachines_agent37_instances_summary,
        dashboard: m.cloudMachines_agent37_dashboard_label(),
        dashboardOpen: m.cloudMachines_agent37_dashboardOpen_label(),
        deleteTitle: m.cloudMachines_agent37_delete_confirmTitle,
        deleteDescription: m.cloudMachines_agent37_delete_confirm_description(),
        creating: m.cloudMachines_agent37_start_creating(),
        startFailed: m.cloudMachines_agent37_startFailure_title(),
        startUnknown: m.cloudMachines_agent37_startFailure_unknown_cause(),
      };
    case 'vercel':
      return {
        keyRejected: m.cloudMachines_vercel_state_tokenRejected_label(),
        unreachable: m.cloudMachines_vercel_state_unreachable_label(),
        ownerOnly: m.cloudMachines_vercel_error_ownerOnly(),
        saved: m.cloudMachines_vercel_saved_toast(),
        listTitle: m.cloudMachines_vercel_sandboxes_title(),
        listSummary: m.cloudMachines_sandboxes_summary,
        dashboard: m.cloudMachines_vercel_dashboard_label(),
        dashboardOpen: m.cloudMachines_vercel_dashboardOpen_label(),
        deleteTitle: m.cloudMachines_delete_confirmTitle,
        deleteDescription: m.cloudMachines_vercel_delete_confirm_description(),
        creating: m.cloudMachines_vercel_start_creating(),
        startFailed: m.cloudMachines_vercel_startFailure_title(),
        startUnknown: m.cloudMachines_vercel_startFailure_unknown_cause(),
      };
    default:
      return {
        keyRejected: m.cloudMachines_state_keyRejected_label(),
        unreachable: m.cloudMachines_state_unreachable_label(),
        ownerOnly: m.cloudMachines_error_ownerOnly(),
        saved: m.cloudMachines_saved_toast(),
        listTitle: m.cloudMachines_sandboxes_title(),
        listSummary: m.cloudMachines_sandboxes_summary,
        dashboard: m.cloudMachines_dashboard_label(),
        dashboardOpen: m.cloudMachines_dashboardOpen_label(),
        deleteTitle: m.cloudMachines_delete_confirmTitle,
        deleteDescription: m.cloudMachines_delete_confirm_description(),
        creating: m.cloudMachines_start_creating(),
        startFailed: m.cloudMachines_startFailure_title(),
        startUnknown: m.cloudMachines_startFailure_unknown_cause(),
      };
  }
}

export function agent37TypeLabel(type: Agent37InstanceType): string {
  return type === 'vm'
    ? m.cloudMachines_agent37_form_type_vm()
    : m.cloudMachines_agent37_form_type_default();
}

export function agent37RegionLabel(region: Agent37Region): string {
  return region === 'eu'
    ? m.cloudMachines_agent37_region_eu()
    : region === 'ap-south'
      ? m.cloudMachines_agent37_region_apSouth()
      : m.cloudMachines_agent37_region_us();
}

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

/** The host of a relay map URL, or the URL itself when it does not parse. */
function relayHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * The relay an entry's running sandboxes use; null without one, since a paused
 * sandbox picks up the current setting only at its next resume.
 */
export function cloudEntryRelayLabel(sandboxes: readonly RemoteMachine[]): string | null {
  const sandbox = sandboxes.find((row) => row.cloud?.state === 'running');
  if (!sandbox?.cloud) return null;
  const url = sandbox.cloud.relayUrl;
  return url
    ? m.cloudMachines_relay_host({ host: relayHost(url) })
    : m.cloudMachines_relay_default();
}

/** Sandboxes of one workspace; `key` is the workspace id, or "" for Other. */
export interface SandboxGroup {
  key: string;
  name: string;
  sandboxes: RemoteMachine[];
}

/**
 * Sandboxes by workspace. Groups with a sandbox not paused come first, then by
 * name with Other last; in each group, sandboxes not paused come first, then
 * newest start. A sandbox goes to Other when this app has no name for its workspace.
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
  const paused = (machine: RemoteMachine) => Number(machine.cloud?.state === 'paused');
  const onlyPaused = (group: SandboxGroup) => Number(group.sandboxes.every((row) => paused(row)));
  for (const group of groups.values())
    group.sandboxes.sort(
      (a, b) =>
        paused(a) - paused(b) ||
        (b.cloud?.startedAt ?? '').localeCompare(a.cloud?.startedAt ?? '') ||
        a.id.localeCompare(b.id),
    );
  return [...groups.values()].sort(
    (a, b) =>
      onlyPaused(a) - onlyPaused(b) ||
      Number(a.key === '') - Number(b.key === '') ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.key.localeCompare(b.key),
  );
}

/** A Northflank error in its own words; E2B's copy names E2B and its sandboxes. */
function northflankErrorText(error: CloudMachineErrorData): { title: string; description: string } {
  switch (error.code) {
    case 'cloud-profile-required':
      return {
        title: m.cloudMachines_northflank_error_profileRequired_title(),
        description: m.cloudMachines_northflank_error_profileRequired_description(),
      };
    case 'cloud-quota':
      return {
        title: m.cloudMachines_northflank_error_quota_title(),
        description:
          error.limit === 'plan'
            ? m.cloudMachines_northflank_error_quotaPlan_description()
            : error.limit === 'rate'
              ? m.cloudMachines_northflank_error_quotaRate_description()
              : m.cloudMachines_northflank_error_quotaConcurrency_description(),
      };
    case 'cloud-machine-unavailable': {
      const unavailable = (description: string) => ({
        title: m.cloudMachines_northflank_error_unavailable_title(),
        description,
      });
      switch (error.reason) {
        case 'not-configured':
          return unavailable(m.cloudMachines_northflank_error_notConfigured_description());
        case 'key-rejected':
          return {
            title: m.cloudMachines_northflank_error_tokenRejected_title(),
            description: m.cloudMachines_northflank_error_tokenRejected_description(),
          };
        case 'project-missing':
          return unavailable(m.cloudMachines_northflank_error_projectMissing_description());
        case 'permission-denied':
          return {
            title: m.cloudMachines_northflank_error_permissionDenied_title(),
            description: m.cloudMachines_northflank_error_permissionDenied_description(),
          };
        case 'template-missing':
          return unavailable(m.cloudMachines_northflank_error_imageMissing_description());
        case 'sandbox-lost':
          return {
            title: m.cloudMachines_northflank_error_serviceLost_title(),
            description: m.cloudMachines_northflank_error_serviceLost_description(),
          };
        case 'bootstrap-failed':
          return unavailable(m.cloudMachines_northflank_error_bootstrapFailed_description());
        default:
          return unavailable(m.cloudMachines_northflank_error_apiError_description());
      }
    }
  }
}

/** An Agent37 error in its own words: instances, its API key, its wallet. */
function agent37ErrorText(error: CloudMachineErrorData): { title: string; description: string } {
  switch (error.code) {
    case 'cloud-profile-required':
      return {
        title: m.cloudMachines_agent37_error_profileRequired_title(),
        description: m.cloudMachines_agent37_error_profileRequired_description(),
      };
    case 'cloud-quota':
      return {
        title: m.cloudMachines_agent37_error_quota_title(),
        description:
          error.limit === 'plan'
            ? m.cloudMachines_agent37_error_quotaPlan_description()
            : error.limit === 'rate'
              ? m.cloudMachines_agent37_error_quotaRate_description()
              : m.cloudMachines_agent37_error_quotaConcurrency_description(),
      };
    case 'cloud-machine-unavailable': {
      const unavailable = (description: string) => ({
        title: m.cloudMachines_agent37_error_unavailable_title(),
        description,
      });
      switch (error.reason) {
        case 'not-configured':
          return unavailable(m.cloudMachines_agent37_error_notConfigured_description());
        case 'key-rejected':
          return {
            title: m.cloudMachines_agent37_error_keyRejected_title(),
            description: m.cloudMachines_agent37_error_keyRejected_description(),
          };
        case 'permission-denied':
          return {
            title: m.cloudMachines_agent37_error_permissionDenied_title(),
            description: m.cloudMachines_agent37_error_permissionDenied_description(),
          };
        case 'no-capacity':
          return {
            title: m.cloudMachines_agent37_error_noCapacity_title(),
            description: m.cloudMachines_agent37_error_noCapacity_description(),
          };
        case 'template-missing':
          return unavailable(m.cloudMachines_agent37_error_templateMissing_description());
        case 'sandbox-lost':
          return {
            title: m.cloudMachines_agent37_error_instanceLost_title(),
            description: m.cloudMachines_agent37_error_instanceLost_description(),
          };
        case 'bootstrap-failed':
          return unavailable(m.cloudMachines_agent37_error_bootstrapFailed_description());
        default:
          return unavailable(m.cloudMachines_agent37_error_apiError_description());
      }
    }
  }
}

/** A Vercel error in its own words: its token, team, project and image. */
function vercelErrorText(error: CloudMachineErrorData): { title: string; description: string } {
  switch (error.code) {
    case 'cloud-profile-required':
      return {
        title: m.cloudMachines_vercel_error_profileRequired_title(),
        description: m.cloudMachines_vercel_error_profileRequired_description(),
      };
    case 'cloud-quota':
      return {
        title: m.cloudMachines_vercel_error_quota_title(),
        description:
          error.limit === 'plan'
            ? m.cloudMachines_vercel_error_quotaPlan_description()
            : error.limit === 'rate'
              ? m.cloudMachines_vercel_error_quotaRate_description()
              : m.cloudMachines_vercel_error_quotaConcurrency_description(),
      };
    case 'cloud-machine-unavailable': {
      const unavailable = (description: string) => ({
        title: m.cloudMachines_vercel_error_unavailable_title(),
        description,
      });
      switch (error.reason) {
        case 'not-configured':
          return unavailable(m.cloudMachines_vercel_error_notConfigured_description());
        case 'key-rejected':
          return {
            title: m.cloudMachines_vercel_error_keyRejected_title(),
            description: m.cloudMachines_vercel_error_keyRejected_description(),
          };
        case 'project-missing':
          return unavailable(m.cloudMachines_vercel_error_projectMissing_description());
        case 'permission-denied':
          return {
            title: m.cloudMachines_vercel_error_permissionDenied_title(),
            description: m.cloudMachines_vercel_error_permissionDenied_description(),
          };
        case 'template-missing':
          return unavailable(m.cloudMachines_vercel_error_imageMissing_description());
        case 'sandbox-lost':
          return {
            title: m.cloudMachines_vercel_error_sandboxLost_title(),
            description: m.cloudMachines_vercel_error_sandboxLost_description(),
          };
        case 'bootstrap-failed':
          return unavailable(m.cloudMachines_vercel_error_bootstrapFailed_description());
        default:
          return unavailable(m.cloudMachines_vercel_error_apiError_description());
      }
    }
  }
}

/**
 * Title and description of a cloud error, for notices and form errors. The
 * error's own `provider` wins; else `provider`, the entry the caller shows.
 */
export function cloudErrorText(
  error: CloudMachineErrorData,
  provider?: CloudProviderKind,
): {
  title: string;
  description: string;
} {
  if (error.code === 'cloud-machine-unavailable' && error.reason === 'relay-unreachable')
    return {
      title: m.cloudMachines_error_relayUnreachable_title(),
      description: error.relayUrl
        ? m.cloudMachines_error_relayUnreachable_description({ host: relayHost(error.relayUrl) })
        : m.cloudMachines_error_relayUnreachable_noHost_description(),
    };
  const kind = error.provider ?? provider;
  if (kind === 'northflank') return northflankErrorText(error);
  if (kind === 'agent37') return agent37ErrorText(error);
  if (kind === 'vercel') return vercelErrorText(error);
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
