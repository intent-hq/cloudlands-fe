export type RtkSettingsIntent =
  { kind: 'load' } | { kind: 'probe' } | { kind: 'toggle'; enabled: boolean } | { kind: 'install' };
