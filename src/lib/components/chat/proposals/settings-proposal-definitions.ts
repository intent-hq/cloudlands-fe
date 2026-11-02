import type { AppSettingDefinition } from '$shared/app-settings-schema';
import { findAppSettingDefinition } from '$shared/app-settings-schema';
import { m } from '$shared/paraglide/messages.js';
import type { SettingDefinitionWithValue } from '$lib/client/app-client';
import { appClient } from '$lib/client';

/**
 * How a settings-change card resolves the setting behind one change.
 *
 * The app schema owns app-local settings and the daemon settings that need
 * app-side wiring. Every other daemon setting is applied generically through
 * `settings.update`, using the definition the daemon itself returns from
 * `settings.get` — never anything in the proposal payload. The daemon's
 * `proposable` flag (PROTOCOL §5.12) is the single gate for which daemon
 * settings a chat card may change, so new daemon settings need no app change.
 */
export type ResolvedProposalSetting =
  /** An app-local setting from the app schema. */
  | { kind: 'app'; definition: AppSettingDefinition }
  /**
   * An app-schema setting backed by the daemon. `entry` is the daemon's
   * current setting, or `null` when the read failed.
   */
  | {
      kind: 'app-daemon';
      definition: AppSettingDefinition;
      entry: SettingDefinitionWithValue | null;
    }
  /** A proposable daemon setting outside the app schema, applied generically. */
  | { kind: 'daemon'; definition: AppSettingDefinition; entry: SettingDefinitionWithValue }
  | { kind: 'unknown' };

class SettingNotProposableError extends Error {
  constructor(path: string) {
    super(m.chat_settingsProposalActions_notProposable_error({ path }));
    this.name = 'SettingNotProposableError';
  }
}

const DAEMON_VALUE_TYPES = new Set<SettingDefinitionWithValue['type']>([
  'boolean',
  'number',
  'string',
  'enum',
  'object',
]);

/**
 * A daemon setting a card may change: the daemon must say so explicitly, so an
 * older daemon that omits the flag fails closed. Sensitive settings are never
 * proposable, whatever the flag says.
 */
function isProposableDaemonSetting(entry: SettingDefinitionWithValue): boolean {
  return entry.proposable === true && entry.sensitive !== true;
}

/**
 * Card definition for a daemon setting outside the app schema. Validation
 * bounds come from the daemon so the card and `settings.update` agree; a
 * setting without a default reads `null` when unset and may be cleared.
 */
function daemonSettingDefinition(entry: SettingDefinitionWithValue): AppSettingDefinition {
  return {
    path: entry.path,
    label: entry.label || entry.path,
    description: entry.description ?? '',
    category: entry.category ?? 'daemon',
    type: entry.type,
    source: 'daemon-settings',
    storageKey: entry.path,
    defaultValue: entry.defaultValue,
    nullable: entry.defaultValue === undefined,
    ...(entry.enumValues ? { enumValues: entry.enumValues } : {}),
    ...(typeof entry.min === 'number' ? { min: entry.min } : {}),
    ...(typeof entry.max === 'number' ? { max: entry.max } : {}),
    apply: { kind: 'daemon-settings-update', path: entry.path },
  };
}

/**
 * Resolve the setting behind a card change for applying or undoing it.
 * Throws {@link SettingNotProposableError} when the daemon refuses chat
 * changes to the setting, including app-schema settings it backs.
 */
export async function resolveProposalSetting(path: string): Promise<ResolvedProposalSetting> {
  const appDefinition = findAppSettingDefinition(path);
  if (appDefinition && appDefinition.apply.kind !== 'daemon-settings-update') {
    return { kind: 'app', definition: appDefinition };
  }
  const daemonPath =
    appDefinition?.apply.kind === 'daemon-settings-update' ? appDefinition.apply.path : path;
  const entry = await appClient.settings.get(daemonPath);
  if (appDefinition) {
    // App-schema daemon settings predate the flag: honor an explicit refusal,
    // but keep applying them against an older daemon that omits it.
    if (entry && (entry.proposable === false || entry.sensitive === true)) {
      throw new SettingNotProposableError(path);
    }
    return { kind: 'app-daemon', definition: appDefinition, entry };
  }
  if (!entry || entry.path !== path || !DAEMON_VALUE_TYPES.has(entry.type)) {
    return { kind: 'unknown' };
  }
  if (!isProposableDaemonSetting(entry)) throw new SettingNotProposableError(path);
  return { kind: 'daemon', definition: daemonSettingDefinition(entry), entry };
}

/**
 * Display-only lookup for the card: the app schema first, then a proposable
 * daemon setting. Never throws; `undefined` renders the raw value.
 */
export async function loadCardSettingDefinition(
  path: string,
): Promise<AppSettingDefinition | undefined> {
  const appDefinition = findAppSettingDefinition(path);
  if (appDefinition) return appDefinition;
  try {
    const entry = await appClient.settings.get(path);
    if (!entry || entry.path !== path || !isProposableDaemonSetting(entry)) return undefined;
    if (!DAEMON_VALUE_TYPES.has(entry.type)) return undefined;
    return daemonSettingDefinition(entry);
  } catch {
    return undefined;
  }
}
