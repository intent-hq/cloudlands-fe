/** Collision-free identity shared by observer membership and request lifetimes. */
export function providerModelsContextKey(providerId: string, workspaceId?: string): string {
  return JSON.stringify([workspaceId || null, providerId]);
}
