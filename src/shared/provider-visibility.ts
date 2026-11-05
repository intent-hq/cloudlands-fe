/** Auggie is offered only to existing installations or users who enabled it. */
export function isProviderListed(
  providerId: string | undefined,
  installed: boolean | undefined,
  enabled = false,
): boolean {
  return providerId !== 'auggie' || installed === true || enabled;
}
