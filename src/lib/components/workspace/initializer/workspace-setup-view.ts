import { getContext, setContext } from 'svelte';

type SetupViewHost = (back: (() => void) | null) => void;

const setupViewContext = Symbol('workspace-setup-view');

export function provideWorkspaceSetupView(host: SetupViewHost): void {
  setContext(setupViewContext, host);
}

export function useWorkspaceSetupView(): SetupViewHost | undefined {
  return getContext<SetupViewHost | undefined>(setupViewContext);
}
