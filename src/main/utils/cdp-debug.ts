type CdpEnvironment = Record<string, string | undefined>;

export function isCdpMcpBridgeEnabled(environment: CdpEnvironment): boolean {
  return (
    environment.NODE_ENV === 'development' &&
    environment.ENABLE_CDP_DEBUG === 'true' &&
    environment.ENABLE_CDP_MCP_BRIDGE === 'true'
  );
}
