/**
 * Cloud machines on E2B, Northflank, Agent37 or Vercel (PROTOCOL `methods/nodes.md` → "Cloud machines").
 *
 * The backend owner saves one or more named entries, each with its own API key
 * (E2B, Agent37) or token (Northflank, Vercel); the backend then starts one machine per agent
 * placed on an entry. The secret is a write-only `cloudMachines.configure`
 * param: no type below carries it, so it never lands in Redux.
 */

/** Cloud providers an entry can use. */
export type CloudProviderKind = 'e2b' | 'northflank' | 'agent37' | 'vercel';
const CLOUD_PROVIDER_KINDS: readonly CloudProviderKind[] = [
  'e2b',
  'northflank',
  'agent37',
  'vercel',
];
export function isCloudProviderKind(value: unknown): value is CloudProviderKind {
  return CLOUD_PROVIDER_KINDS.includes(value as CloudProviderKind);
}
/** The provider an entry id names: "northflank-", "agent37-" or "vercel-<12 hex>", else E2B. */
export function cloudProviderOfEntryId(cloudMachineId: string | undefined): CloudProviderKind {
  if (cloudMachineId?.startsWith('northflank-')) return 'northflank';
  if (cloudMachineId?.startsWith('vercel-')) return 'vercel';
  return cloudMachineId?.startsWith('agent37-') ? 'agent37' : 'e2b';
}
const CLOUD_PROVIDER_NAMES: Record<CloudProviderKind, string> = {
  e2b: 'E2B', // i18n-ignore (product name)
  northflank: 'Northflank', // i18n-ignore (product name)
  agent37: 'Agent37', // i18n-ignore (product name)
  vercel: 'Vercel', // i18n-ignore (product name)
};
/** The product name, for labels and default entry names. */
export function cloudProviderName(provider: CloudProviderKind): string {
  return CLOUD_PROVIDER_NAMES[provider];
}

/** The entry an older backend keeps, and the one every migrated setup becomes. */
export const DEFAULT_CLOUD_MACHINE_ID = 'e2b';
/** Entry names: 1-64 UTF-8 bytes after trimming. */
export const CLOUD_ENTRY_NAME_MAX_BYTES = 64;
/** At most this many entries per backend. */
export const CLOUD_ENTRY_LIMIT = 16;

/** `4x16` and `4x32` are Agent37 only; Agent37 has no `8x16` or `16x32`. */
export type CloudMachineSize = '2x4' | '4x8' | '8x16' | '16x32' | '4x16' | '4x32';
const CLOUD_MACHINE_SIZES: readonly CloudMachineSize[] = [
  '2x4',
  '4x8',
  '8x16',
  '16x32',
  '4x16',
  '4x32',
];
export const DEFAULT_CLOUD_MACHINE_SIZE: CloudMachineSize = '4x8';
export const DEFAULT_IDLE_PAUSE_MINUTES = 10;
export const DEFAULT_PAUSED_DELETE_DAYS = 7;

export interface CloudMachineSizeInfo {
  id: CloudMachineSize;
  vcpu: number;
  memoryMiB: number;
  /** E2B only: the lowest plan that allows the size. */
  plan?: 'hobby' | 'pro-raised-limits' | string;
  /** Northflank only: the deployment plan id, for example "nf-compute-400". */
  deploymentPlan?: string;
}

/** A Northflank entry's own settings (`CloudMachineProvider.northflank`). */
interface NorthflankEntrySettings {
  projectId: string;
  /** The project's region, read from Northflank; not a configure param. */
  region: string;
  /** Image repository without a tag. */
  image: string;
  plans: Partial<Record<CloudMachineSize, string>>;
  diskGiB: number;
}

export type Agent37InstanceType = 'default' | 'vm';
export type Agent37Region = 'us' | 'eu' | 'ap-south';
export const AGENT37_REGIONS: readonly Agent37Region[] = ['us', 'eu', 'ap-south'];

/** An Agent37 entry's own settings (`CloudMachineProvider.agent37`). */
interface Agent37EntrySettings {
  /** `default` is a gVisor sandbox in the US only; `vm` a full VM in any region. */
  instanceType: Agent37InstanceType;
  region: Agent37Region;
  diskGiB: number;
}

/** Agent37 always offers these four sizes, on both types, so a new entry knows them before a test. */
export const AGENT37_SIZES: readonly CloudMachineSizeInfo[] = [
  { id: '2x4', vcpu: 2, memoryMiB: 4096 },
  { id: '4x8', vcpu: 4, memoryMiB: 8192 },
  { id: '4x16', vcpu: 4, memoryMiB: 16384 },
  { id: '4x32', vcpu: 4, memoryMiB: 32768 },
];

/** A Vercel entry's own settings (`CloudMachineProvider.vercel`). */
interface VercelEntrySettings {
  /** "team_…" */
  teamId: string;
  /** "prj_…" */
  projectId: string;
  /** A Vercel registry repository without a tag; the backend adds the version. */
  image: string;
}

/** Intent's public node image on Vercel, the image of an entry without its own. */
export const DEFAULT_VERCEL_IMAGE = 'sutterhill/intent-images/intent-node';
/** `configure` refuses any other team or project id. */
export const VERCEL_TEAM_ID = /^team_[A-Za-z0-9]{1,64}$/u;
export const VERCEL_PROJECT_ID = /^prj_[A-Za-z0-9]{1,64}$/u;

const VERCEL_TEAM_SLUG = /^[a-z0-9-]+$/u;
const VERCEL_IMAGE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/u;
/**
 * A Vercel registry repository without tag or digest: "<team slug>/<project>/<repository>",
 * or "<repository>" in the entry's own project. A registry host or tag is refused.
 */
export function isVercelImage(image: string): boolean {
  const segments = image.split('/');
  return (
    (segments.length === 1 || segments.length === 3) &&
    segments.every((segment) => VERCEL_IMAGE_SEGMENT.test(segment)) &&
    (segments.length === 1 || VERCEL_TEAM_SLUG.test(segments[0]!))
  );
}

/** Vercel gives 2 GB per vCPU at every size, so a new entry knows them before a test. */
export const VERCEL_SIZES: readonly CloudMachineSizeInfo[] = [
  { id: '2x4', vcpu: 2, memoryMiB: 4096 },
  { id: '4x8', vcpu: 4, memoryMiB: 8192 },
  { id: '8x16', vcpu: 8, memoryMiB: 16384 },
];

type CloudProviderState = 'ready' | 'key-rejected' | 'unreachable';

/** One named entry (`CloudMachineProvider` on the wire). */
export interface CloudMachineProvider {
  /** The `cloudMachineId`: "e2b", or "e2b-", "northflank-", "agent37-" or "vercel-<12 hex>"; "" on a `validateOnly` create. */
  id: string;
  provider: CloudProviderKind;
  name: string;
  state: CloudProviderState | string;
  template: string;
  /** E2B only; "" on the other providers. */
  templateProject: string;
  agentProviders: string[];
  /** Published sizes for this backend's version, smallest first. */
  sizes: CloudMachineSizeInfo[];
  size: CloudMachineSize;
  idlePauseMinutes: number;
  pausedDeleteDays: number;
  configuredAt: string;
  checkedAt?: string;
  northflank?: NorthflankEntrySettings;
  agent37?: Agent37EntrySettings;
  vercel?: VercelEntrySettings;
}

type CloudSandboxState = 'running' | 'pausing' | 'paused' | 'resuming' | 'stopping';

/** `RemoteMachine.cloud`: only on cloud machine rows. */
export interface CloudMachineState {
  provider: CloudProviderKind;
  /** The entry the sandbox started from; "e2b" from an older backend. */
  cloudMachineId: string;
  /** E2B's or Vercel's sandbox id, the Northflank service id, or the Agent37 instance id. */
  sandboxId: string;
  state: CloudSandboxState | string;
  template: string;
  size: CloudMachineSize | string;
  startedBy: { principalId: string; displayName: string | null };
  agentId: string;
  workspaceId: string;
  startedAt: string;
  runningSeconds: number;
}

/** `cloudMachines.configure` params; the saga maps the secret to the provider's names. */
export interface CloudMachineConfigureInput {
  /** The provider of a new entry; an update keeps the entry's own. Default "e2b". */
  provider?: CloudProviderKind;
  /** The entry to update; omit to create one. Sent only with `cloudMachineEntries: 1`. */
  cloudMachineId?: string;
  /** Required to create an entry; renames on update. Sent only with `cloudMachineEntries: 1`. */
  name?: string;
  /** Copy another entry's saved key (or token) instead of sending one. */
  apiKeyFrom?: string;
  /** Secret, the E2B or Agent37 key or Northflank or Vercel token: sent once, never stored in state. */
  apiKey?: string;
  /** Northflank and Vercel; required to create. */
  projectId?: string;
  /** Vercel only; required to create. */
  teamId?: string;
  /** Vercel only: a registry repository without a tag; "" goes back to Intent's public image. */
  image?: string;
  /** Agent37 only. */
  instanceType?: Agent37InstanceType;
  /** Agent37 only; `eu` and `ap-south` need `instanceType: "vm"`. */
  region?: Agent37Region;
  size?: CloudMachineSize;
  idlePauseMinutes?: number;
  pausedDeleteDays?: number;
}

/** The typed error data of the three cloud codes (PROTOCOL "Remote machine errors"). */
export type CloudMachineErrorData =
  | {
      code: 'cloud-machine-unavailable';
      reason: string;
      retryable: boolean;
      status?: number;
      provider?: CloudProviderKind;
      /** Only with `permission-denied`: the refused provider call. */
      action?: string;
    }
  | { code: 'cloud-profile-required'; providerRef?: string; provider?: CloudProviderKind }
  | {
      code: 'cloud-quota';
      limit: 'concurrency' | 'rate' | 'plan' | string;
      retryAfterSeconds?: number;
      retryable: boolean;
      provider?: CloudProviderKind;
    };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const positiveInt = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;

export function isCloudMachineSize(value: unknown): value is CloudMachineSize {
  return CLOUD_MACHINE_SIZES.includes(value as CloudMachineSize);
}

function parseSize(value: unknown, provider: CloudProviderKind): CloudMachineSizeInfo | null {
  if (!record(value) || !isCloudMachineSize(value.id)) return null;
  const vcpu = positiveInt(value.vcpu);
  const memoryMiB = positiveInt(value.memoryMiB);
  if (!vcpu || !memoryMiB) return null;
  // Agent37 and Vercel start one image at every size: no plan of either kind.
  if (provider === 'agent37' || provider === 'vercel') return { id: value.id, vcpu, memoryMiB };
  return {
    id: value.id,
    vcpu,
    memoryMiB,
    ...(text(value.deploymentPlan)
      ? { deploymentPlan: value.deploymentPlan }
      : { plan: text(value.plan) ? value.plan : 'hobby' }),
  };
}

/**
 * Narrow one wire `CloudMachineProvider`; null for an unknown provider or
 * shape. A row without `provider` comes from a backend without entries and
 * is read only as the entry "e2b".
 */
export function parseCloudMachineProvider(value: unknown): CloudMachineProvider | null {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !text(value.state) ||
    !text(value.configuredAt)
  )
    return null;
  if (
    value.provider === undefined
      ? value.id !== DEFAULT_CLOUD_MACHINE_ID
      : !isCloudProviderKind(value.provider)
  )
    return null;
  const provider: CloudProviderKind = isCloudProviderKind(value.provider) ? value.provider : 'e2b';
  return {
    id: value.id,
    provider,
    name: text(value.name) ? value.name : cloudProviderName(provider),
    state: value.state,
    template: text(value.template) ? value.template : '',
    templateProject: text(value.templateProject) ? value.templateProject : '',
    agentProviders: Array.isArray(value.agentProviders)
      ? value.agentProviders.filter((id): id is string => text(id))
      : [],
    sizes: Array.isArray(value.sizes)
      ? value.sizes.flatMap((size) => parseSize(size, provider) ?? [])
      : [],
    size: isCloudMachineSize(value.size) ? value.size : DEFAULT_CLOUD_MACHINE_SIZE,
    idlePauseMinutes: positiveInt(value.idlePauseMinutes) ?? DEFAULT_IDLE_PAUSE_MINUTES,
    pausedDeleteDays: positiveInt(value.pausedDeleteDays) ?? DEFAULT_PAUSED_DELETE_DAYS,
    configuredAt: value.configuredAt,
    ...(text(value.checkedAt) ? { checkedAt: value.checkedAt } : {}),
    ...(provider === 'northflank' ? { northflank: parseNorthflankSettings(value.northflank) } : {}),
    ...(provider === 'agent37' ? { agent37: parseAgent37Settings(value.agent37) } : {}),
    ...(provider === 'vercel' ? { vercel: parseVercelSettings(value.vercel) } : {}),
  };
}

function parseVercelSettings(value: unknown): VercelEntrySettings {
  const settings = record(value) ? value : {};
  const field = (key: string) => (text(settings[key]) ? (settings[key] as string) : '');
  return {
    teamId: field('teamId'),
    projectId: field('projectId'),
    image: field('image') || DEFAULT_VERCEL_IMAGE,
  };
}

function parseAgent37Settings(value: unknown): Agent37EntrySettings {
  const settings = record(value) ? value : {};
  const region = AGENT37_REGIONS.find((id) => id === settings.region) ?? 'us';
  return {
    instanceType: settings.instanceType === 'vm' ? 'vm' : 'default',
    region,
    diskGiB: positiveInt(settings.diskGiB) ?? 20,
  };
}

function parseNorthflankSettings(value: unknown): NorthflankEntrySettings {
  const settings = record(value) ? value : {};
  const plans = record(settings.plans) ? settings.plans : {};
  return {
    projectId: text(settings.projectId) ? settings.projectId : '',
    region: text(settings.region) ? settings.region : '',
    image: text(settings.image) ? settings.image : '',
    plans: Object.fromEntries(
      Object.entries(plans).filter(
        (entry): entry is [CloudMachineSize, string] =>
          isCloudMachineSize(entry[0]) && text(entry[1]),
      ),
    ),
    diskGiB: positiveInt(settings.diskGiB) ?? 20,
  };
}

/** Narrow `RemoteMachine.cloud`; null when absent or malformed. */
export function parseCloudMachineState(value: unknown): CloudMachineState | null {
  if (
    !record(value) ||
    !isCloudProviderKind(value.provider) ||
    !text(value.sandboxId) ||
    !text(value.state) ||
    !text(value.agentId) ||
    !text(value.workspaceId) ||
    !text(value.startedAt)
  )
    return null;
  const startedBy = record(value.startedBy) ? value.startedBy : {};
  const seconds = value.runningSeconds;
  return {
    provider: value.provider,
    cloudMachineId: text(value.cloudMachineId) ? value.cloudMachineId : DEFAULT_CLOUD_MACHINE_ID,
    sandboxId: value.sandboxId,
    state: value.state,
    template: text(value.template) ? value.template : '',
    size: text(value.size) ? value.size : DEFAULT_CLOUD_MACHINE_SIZE,
    startedBy: {
      principalId: text(startedBy.principalId) ? startedBy.principalId : '',
      displayName: text(startedBy.displayName) ? startedBy.displayName : null,
    },
    agentId: value.agentId,
    workspaceId: value.workspaceId,
    startedAt: value.startedAt,
    runningSeconds:
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
        ? Math.floor(seconds)
        : 0,
  };
}

/** The cloud error data in a JSON-RPC error's `data`, or null for any other code. */
export function parseCloudMachineError(data: unknown): CloudMachineErrorData | null {
  if (!record(data)) return null;
  switch (data.code) {
    case 'cloud-machine-unavailable':
      return {
        code: data.code,
        reason: text(data.reason) ? data.reason : 'api-error',
        retryable: data.retryable === true,
        ...(Number.isInteger(data.status) ? { status: data.status as number } : {}),
        ...(isCloudProviderKind(data.provider) ? { provider: data.provider } : {}),
        ...(text(data.action) ? { action: data.action } : {}),
      };
    case 'cloud-profile-required':
      return {
        code: data.code,
        ...(text(data.providerRef) ? { providerRef: data.providerRef } : {}),
        ...(isCloudProviderKind(data.provider) ? { provider: data.provider } : {}),
      };
    case 'cloud-quota': {
      const retryAfterSeconds = positiveInt(data.retryAfterSeconds);
      return {
        code: data.code,
        limit: text(data.limit) ? data.limit : 'concurrency',
        retryable: data.retryable === true,
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        ...(isCloudProviderKind(data.provider) ? { provider: data.provider } : {}),
      };
    }
    default:
      return null;
  }
}

/** UTF-8 byte length, for the entry name limit. */
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The first free default name: "E2B", then "E2B 2", "E2B 3", … (case-insensitive). */
export function nextCloudEntryName(
  taken: readonly string[],
  provider: CloudProviderKind = 'e2b',
): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const base = cloudProviderName(provider);
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base.toLowerCase()} ${n}`)) return `${base} ${n}`;
}

/** E2B's published per-second rates (USD), billed only while a sandbox runs. */
const USD_PER_VCPU_SECOND = 0.000014;
const USD_PER_GIB_SECOND = 0.0000045;

/** vCPU and GiB of a size id ("4x8"), or null for an unknown id. */
export function cloudSizeResources(size: string): { vcpu: number; memoryGiB: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { vcpu: Number(match[1]), memoryGiB: Number(match[2]) } : null;
}

/** Estimated E2B compute cost in USD for `runningSeconds` at `size`; null for an unknown size. */
export function estimateCloudCost(size: string, runningSeconds: number): number | null {
  const resources = cloudSizeResources(size);
  if (!resources) return null;
  return (
    runningSeconds *
    (resources.vcpu * USD_PER_VCPU_SECOND + resources.memoryGiB * USD_PER_GIB_SECOND)
  );
}
