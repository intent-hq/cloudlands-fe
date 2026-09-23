/**
 * Script text of a workspace's `setupScript`.
 *
 * The wire serves `Workspace.setupScript` as a `SetupScript` record
 * `{ script, updatedAt, projectType?, generatedBy? }` (PROTOCOL §5.25), while
 * the `Workspace` type and FE-local values (onboarding drafts) still carry the
 * bare script string. Consumers that render the script read it through this
 * helper so either shape yields the text; an absent/blank script yields
 * `undefined`.
 *
 * Dependency-light on purpose: no stores, no services.
 */

export type WorkspaceSetupScriptValue = string | { script: string } | null | undefined;

export function workspaceSetupScriptText(value: WorkspaceSetupScriptValue): string | undefined {
  const script =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && typeof value.script === 'string'
        ? value.script
        : undefined;
  return script ? script : undefined;
}
