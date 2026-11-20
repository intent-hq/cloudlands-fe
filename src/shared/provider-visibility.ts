/**
 * Auggie is offered only to existing installations or users who enabled it.
 * Running from its npm package through npx is not an installation.
 */
export function isProviderListed(
  providerId: string | undefined,
  status: { readonly available?: boolean; readonly viaNpx?: boolean } | undefined,
  enabled = false,
): boolean {
  const installed = status?.available === true && status.viaNpx !== true;
  return providerId !== 'auggie' || installed || enabled;
}
