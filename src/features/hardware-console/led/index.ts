export {
  AGENT_KEY_LED_COUNT,
  LED_EFFECT_BREATH,
  LED_EFFECT_OFF,
  LED_EFFECT_SOLID,
  buildRgbcfgParams,
  buildThStatusParams,
  type AgentKeyLedState,
  type AmbientLedState,
  type HardwareLedSnapshot,
  type RgbcfgParams,
  type RgbcfgZone,
  type ThStatusEntry,
} from './frames';
export {
  buildHardwareLedSnapshot,
  deriveAgentKeyLedState,
  type LedSnapshotState,
} from './snapshot';
export {
  DEFAULT_MIN_SEND_INTERVAL_MS,
  HardwareLedEngine,
  type HardwareLedEngineOptions,
  type LedRpcCaller,
} from './engine';
export {
  createHardwareConsoleLedStatusMiddleware,
  installHardwareConsoleLedStatus,
  type LedStatusDeps,
} from './led-status-service';
