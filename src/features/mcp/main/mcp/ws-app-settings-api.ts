import type { SettingsChangeProposal } from '$shared/types/proposal';
import {
  APP_SETTING_DEFINITIONS,
  findAppSettingDefinition,
  formatSettingValue,
  type AppSettingChange,
  type AppSettingDefinition,
} from '$shared/app-settings-schema';
import { Logger } from '$shared/logger';
import { readUserMcpServers } from '../user-mcp-settings';
import type { ToolCall } from './protocol';
import { emitProposalToChat, proposalToolResult } from './ws-app-proposal-content';

const logger = new Logger('WsAppSettingsApi');
const REDACTED = '[redacted]';

type SettingsListOptions = { includeValues?: boolean; category?: string } | undefined;
type SettingsProposalInput = AppSettingChange[] | { changes?: AppSettingChange[] };

export class AppSettingsValidationError extends Error {
  readonly code = 'APP_SETTINGS_VALIDATION_ERROR';

  constructor(
    message: string,
    readonly details: { path?: string; reason: string; expected?: string; value?: unknown },
  ) {
    super(message);
    this.name = 'AppSettingsValidationError';
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

const settingsStores: Record<string, any> = {};

function definitionSummary(definition: AppSettingDefinition) {
  return {
    path: definition.path,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    type: definition.type,
    source: definition.source,
    storageKey: definition.storageKey,
    valuePath: definition.valuePath,
    defaultValue: definition.defaultValue,
    enumValues: definition.enumValues,
    enumLabels: definition.enumLabels,
    min: definition.min,
    max: definition.max,
    nullable: definition.nullable,
    nullLabel: definition.nullLabel,
    apply: definition.apply,
    sensitive: definition.sensitive === true,
  };
}

function deepGet(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function parseLocalStorageValue(
  raw: string | null | undefined,
  definition: AppSettingDefinition,
): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (definition.type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  if (definition.type === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (definition.valuePath || ['object', 'array', 'status', 'readonly'].includes(definition.type)) {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

async function getSettingsStore(storeName = 'settings'): Promise<any | null> {
  if (settingsStores[storeName]) return settingsStores[storeName];
  try {
    const ElectronStore = (await import('electron-store')).default;
    settingsStores[storeName] = new ElectronStore({ name: storeName });
    return settingsStores[storeName];
  } catch (error) {
    logger.warn('Unable to initialize settings store', { storeName, error });
    return null;
  }
}

async function readLocalStorageRaw(key: string): Promise<string | null | undefined> {
  try {
    const electron = await import('electron');
    const BrowserWindow = (electron as any).BrowserWindow;
    const windows =
      typeof BrowserWindow?.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : [];
    for (const window of windows) {
      if (window?.isDestroyed?.() || window?.webContents?.isDestroyed?.()) continue;
      const serializedKey = JSON.stringify(key);
      const value = await window.webContents.executeJavaScript(
        `window.localStorage.getItem(${serializedKey})`,
        true,
      );
      if (value !== null && value !== undefined) return String(value);
    }
  } catch (error) {
    logger.debug('Unable to read localStorage from renderer windows', { key, error });
  }
  return undefined;
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      const sensitiveKey =
        /token|secret|password|credential|authorization|api[-_]?key|private[-_]?key|headers|env/i.test(
          key,
        );
      return [key, sensitiveKey ? REDACTED : redactValue(child)];
    }),
  );
}

function valueForResult(definition: AppSettingDefinition, value: unknown): unknown {
  if (!definition.sensitive) return value;
  if (definition.path === 'accounts.sentry' && value && typeof value === 'object') {
    const config = value as Record<string, unknown>;
    return {
      isAuthenticated:
        typeof config.organization === 'string' && typeof config.apiToken === 'string',
      organization: config.organization ?? null,
      apiToken: REDACTED,
    };
  }
  return redactValue(value);
}

async function readDefinitionValue(definition: AppSettingDefinition): Promise<unknown> {
  let rawValue: unknown;
  if (definition.source === 'static') {
    rawValue = definition.defaultValue;
  } else if (definition.source === 'augment-settings') {
    rawValue = await readUserMcpServers();
  } else if (definition.source === 'electron-store') {
    const store = await getSettingsStore(definition.storeName);
    rawValue = definition.storageKey && store ? store.get(definition.storageKey) : undefined;
  } else if (definition.source === 'local-storage') {
    const raw = definition.storageKey
      ? await readLocalStorageRaw(definition.storageKey)
      : undefined;
    rawValue = parseLocalStorageValue(raw, definition);
  }

  const selected = deepGet(rawValue, definition.valuePath);
  return selected === undefined ? definition.defaultValue : selected;
}

async function settingResult(definition: AppSettingDefinition) {
  const value = await readDefinitionValue(definition);
  return {
    ...definitionSummary(definition),
    value: valueForResult(definition, value),
    valueRedacted: definition.sensitive === true,
  };
}

function getChanges(input: SettingsProposalInput): AppSettingChange[] {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object' && Array.isArray(input.changes)) return input.changes;
  throw new Error('propose() requires an array of changes or { changes: [...] }');
}

function settingValidationError(
  definition: AppSettingDefinition | undefined,
  reason: string,
  expected: string,
  value: unknown,
): AppSettingsValidationError {
  const path = definition?.path;
  const reasonForMessage =
    path && reason.startsWith('value ') ? reason.replace(/^value /, '') : reason;
  return new AppSettingsValidationError(
    path
      ? `Invalid app setting change: ${path} ${reasonForMessage}`
      : `Invalid app setting change: ${reason}`,
    { path, reason, expected, value },
  );
}

function validateValue(definition: AppSettingDefinition, value: unknown): void {
  if (definition.apply.kind === 'read-only') {
    throw settingValidationError(
      definition,
      'setting is read-only',
      'a writable setting path',
      value,
    );
  }
  if (definition.sensitive) {
    throw settingValidationError(
      definition,
      'setting is sensitive and cannot be changed via MCP proposals',
      'a non-sensitive setting path',
      REDACTED,
    );
  }
  if (value === null && definition.nullable === true) return;
  if (definition.type === 'enum') {
    if (typeof value !== 'string' || !definition.enumValues?.includes(value)) {
      throw settingValidationError(
        definition,
        `value must be one of: ${(definition.enumValues ?? []).join(', ')}`,
        'enum',
        value,
      );
    }
    return;
  }
  if (definition.type === 'array' && !Array.isArray(value)) {
    throw settingValidationError(definition, 'value must be an array', 'array', value);
  }
  if (
    definition.type === 'object' &&
    (!value || typeof value !== 'object' || Array.isArray(value))
  ) {
    throw settingValidationError(definition, 'value must be an object', 'object', value);
  }
  if (definition.type === 'boolean' && typeof value !== 'boolean') {
    throw settingValidationError(definition, 'value must be a boolean', 'boolean', value);
  }
  if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw settingValidationError(definition, 'value must be a finite number', 'number', value);
    }
    if (definition.min !== undefined && value < definition.min) {
      throw settingValidationError(
        definition,
        `value must be >= ${definition.min}`,
        'number',
        value,
      );
    }
    if (definition.max !== undefined && value > definition.max) {
      throw settingValidationError(
        definition,
        `value must be <= ${definition.max}`,
        'number',
        value,
      );
    }
  }
  if (definition.type === 'string' && typeof value !== 'string' && value !== null) {
    throw settingValidationError(definition, 'value must be a string', 'string', value);
  }
}

async function buildProposal(changes: AppSettingChange[]): Promise<SettingsChangeProposal> {
  if (changes.length === 0) throw new Error('propose() requires at least one change');

  const rows = await Promise.all(
    changes.map(async (change) => {
      const definition = findAppSettingDefinition(change.path);
      if (!definition) {
        throw new AppSettingsValidationError(`Unknown app setting path: ${change.path}`, {
          path: change.path,
          reason: 'unknown setting path',
          expected: 'a path from APP_SETTING_DEFINITIONS',
          value: change.value,
        });
      }
      validateValue(definition, change.value);
      const before = await readDefinitionValue(definition);
      return { change, definition, before };
    }),
  );

  const formattedRows = rows.map(({ change, definition, before }) => ({
    change,
    definition,
    before: formatSettingValue(definition, before),
    after: formatSettingValue(definition, change.value),
  }));
  const isSingleChange = formattedRows.length === 1;
  const title = isSingleChange
    ? `${formattedRows[0].definition.label}: ${formattedRows[0].after}`
    : `Update ${formattedRows.length} settings`;
  const summary = isSingleChange
    ? `Switch the ${formattedRows[0].definition.label.toLowerCase()} to ${formattedRows[0].after}.`
    : formattedRows.map(({ definition }) => definition.label).join(', ');

  return {
    kind: 'settings-change',
    payload: {
      changes: rows.map(({ change, definition }) => ({
        path: definition.path,
        value: change.value,
        reason: change.reason,
        apply: definition.apply,
      })),
    },
    preview: {
      title,
      summary,
      applyLabel: 'Apply',
      fields: formattedRows.map(({ definition, before, after }) => ({
        key: definition.path,
        label: definition.label,
        before,
        after,
        editable: true,
        multiline: definition.type === 'object' || definition.type === 'array',
      })),
    },
  };
}

export function buildWsAppSettingsApi(workspaceId: string, call: ToolCall) {
  return {
    async list(options?: SettingsListOptions) {
      const definitions = APP_SETTING_DEFINITIONS.filter((definition) => {
        return !options?.category || definition.category === options.category;
      });
      if (options?.includeValues === false) return definitions.map(definitionSummary);
      return Promise.all(definitions.map(settingResult));
    },

    async get(path: string) {
      if (!path || typeof path !== 'string') throw new Error('get(path) requires a setting path');
      const definition = findAppSettingDefinition(path);
      if (!definition) throw new Error(`Unknown app setting path: ${path}`);
      return settingResult(definition);
    },

    async propose(input: SettingsProposalInput) {
      const proposal = await buildProposal(getChanges(input));
      const emitResult = emitProposalToChat(workspaceId, call.context?.agentId, proposal);
      if (!emitResult.ok) {
        throw new Error(`Failed to emit proposal to chat: ${emitResult.error}`);
      }
      return proposalToolResult(proposal);
    },
  };
}
