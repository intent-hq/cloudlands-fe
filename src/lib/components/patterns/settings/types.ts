import type { Snippet } from 'svelte';

export type SettingsTab =
  | 'display'
  | 'app-behavior'
  | 'agent-behavior'
  | 'providers'
  | 'connections'
  | 'devices'
  | 'setup'
  | 'advanced'
  | 'input'
  | 'specialists';

export type SettingKind =
  'switch' | 'select' | 'input' | 'number' | 'path' | 'keybinding' | 'action' | 'custom';

export type Resolvable<T> = T | (() => T);

export interface SettingStore<T> {
  subscribe(run: (value: T) => void): () => void;
  set(value: T): void;
}

interface BaseSetting<K extends SettingKind> {
  kind: K;
  id: string;
  label: string;
  description?: string;
  when?: () => boolean;
  disabled?: Resolvable<boolean>;
  busy?: Resolvable<boolean>;
  error?: Resolvable<string | undefined>;
  status?: Resolvable<string | undefined>;
  statusTone?: 'info' | 'subtle';
  danger?: boolean;
  experimental?: boolean;
  featureCode?: string;
}

interface ValueSetting<T> {
  get?: () => T;
  set?: (value: T) => void | Promise<void>;
  store?: SettingStore<T>;
}

export interface SwitchSetting extends BaseSetting<'switch'>, ValueSetting<boolean> {}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectSetting extends BaseSetting<'select'>, ValueSetting<string> {
  options: SelectOption[];
  placeholder?: string;
}

export interface InputSetting extends BaseSetting<'input'>, ValueSetting<string> {
  placeholder?: string;
  inputType?: 'text' | 'email' | 'password' | 'url';
  onBlur?: () => void;
}

export interface NumberSetting extends BaseSetting<'number'>, ValueSetting<number> {
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  onBlur?: () => void;
}

export interface PathSetting extends BaseSetting<'path'>, ValueSetting<string> {
  placeholder?: string;
  readonly?: boolean;
  onBlur?: () => void;
}

export interface KeybindingSetting extends BaseSetting<'keybinding'>, ValueSetting<string> {
  placeholder?: string;
  readonly?: boolean;
  onKeydown?: (event: KeyboardEvent) => void;
}

export interface ActionSetting extends BaseSetting<'action'> {
  get?: never;
  set?: never;
  store?: never;
  actionLabel: string;
  action: () => void | Promise<void>;
  variant?: 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
}

export type CustomSetting = BaseSetting<'custom'>;

export type SettingEntry =
  | SwitchSetting
  | SelectSetting
  | InputSetting
  | NumberSetting
  | PathSetting
  | KeybindingSetting
  | ActionSetting
  | CustomSetting;

export interface SettingsSectionSchema {
  id: string;
  title: string;
  description?: string;
  when?: () => boolean;
  entries: SettingEntry[];
}

export interface SettingsSchema {
  sections: SettingsSectionSchema[];
}

export interface SettingsControlContext {
  entry: SettingEntry;
  controlId: string;
  labelId: string;
  descriptionId?: string;
  errorId?: string;
  disabled: boolean;
  busy: boolean;
}

export type SettingsCustomControls = Record<string, Snippet<[SettingsControlContext]>>;
export type SettingsDescriptionSnippets = Record<string, Snippet>;
