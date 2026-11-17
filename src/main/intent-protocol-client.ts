import type { App } from 'electron';
type ProtocolClient = Pick<App, 'isPackaged' | 'setAsDefaultProtocolClient'>;

export function configureIntentProtocolClient(
  application: ProtocolClient,
  isolatedTestBuild: boolean,
): 'registered' | 'skipped' | 'failed' {
  if (isolatedTestBuild || !application.isPackaged) return 'skipped';
  return application.setAsDefaultProtocolClient('intent') ? 'registered' : 'failed';
}
