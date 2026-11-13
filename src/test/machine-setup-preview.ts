import { store } from '$store/renderer/store';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import { pasteFailed, pasteFieldOpened, pasteTestingStarted } from '$features/nodes/nodes-slice';
import {
  lastSshLoginLoaded,
  machineSetupClosed,
  machineSetupInstallPicked,
  machineSetupOpened,
  machineSetupScreenShown,
  sshDefaultsLoaded,
  sshSetupDone,
  sshSetupEventReceived,
  sshSetupFailed,
  sshRunShown,
  sshSetupStarted,
  type SshRunFailure,
} from '$features/machine-setup/machine-setup-slice';
import type { SshLoginPrefill, SshSetupEvent, SshSetupStep } from '$shared/types/machine-setup';
import { maskPairingUri } from '$shared/utils/pairing-uri';

export type MachineSetupPreviewState =
  | 'pick'
  | 'pick-with-node'
  | 'paste'
  | 'paste-testing'
  | 'paste-error'
  | 'details'
  | 'method'
  | 'manual-backend'
  | 'manual-node'
  | 'ssh-login'
  | 'ssh-login-no-agent'
  | 'ssh-login-password'
  | 'ssh-connecting'
  | 'ssh-installing'
  | 'ssh-host-key'
  | 'ssh-unreachable'
  | 'ssh-auth-refused'
  | 'ssh-host-key-mismatch'
  | 'ssh-unsupported-os'
  | 'ssh-install-failed'
  | 'ssh-no-link'
  | 'ssh-link-rejected'
  | 'ssh-done-linger'
  | 'ssh-existing-pairing'
  | 'ssh-existing-started'
  | 'ssh-existing-done'
  | 'ssh-no-start'
  | 'ssh-did-not-start'
  | 'ssh-too-old'
  | 'ssh-orchestrator';

const LOGIN: SshLoginPrefill = {
  host: 'build-2.example.com',
  port: 22,
  username: 'deploy',
  method: 'agent',
  keyPath: '~/.ssh/id_ed25519',
};
const RUN = 'preview-run';
type SshSetupEventBody = SshSetupEvent extends infer E
  ? E extends SshSetupEvent
    ? Omit<E, 'runId'>
    : never
  : never;
const LOG = [
  'install.sh: downloading intentd-x86_64-unknown-linux-musl.tar.xz from the sitter-latest release...',
  'install.sh: sha256 verified',
  'install.sh: installed intentd-sitter 0.11.191 to /home/deploy/.local/bin/intentd',
  'install.sh: systemd user unit installed and started: /home/deploy/.config/systemd/user/intentd.service',
  'install.sh: waiting for the daemon to respond (first start downloads the daemon binary)...',
];

function run(step: SshSetupStep, log: string[] = LOG) {
  store.dispatch(machineSetupInstallPicked('backend'));
  store.dispatch(sshRunShown(LOGIN));
  store.dispatch(sshSetupStarted(RUN, LOGIN.host, LOGIN.username));
  const event = (e: SshSetupEventBody) =>
    store.dispatch(sshSetupEventReceived({ runId: RUN, ...e } as SshSetupEvent));
  event({ type: 'step', step });
  if (log.length) event({ type: 'log', lines: log });
  return event;
}

function fail(step: SshSetupStep, failure: Omit<SshRunFailure, 'step'>, log: string[] = LOG) {
  run(step, log);
  store.dispatch(sshSetupFailed({ step, ...failure }));
}

/** Put the wizard in `state`; returns the restore. */
export function setupMachineSetupFixture(state: MachineSetupPreviewState): () => void {
  const previousLabs = store.state.userPreferences?.labsRemoteAgentsEnabled === true;
  store.dispatch(setLabsRemoteAgentsEnabled(state === 'pick-with-node'));
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: [],
      localFingerprint: null,
      executorBackends: [],
    }),
  );
  store.dispatch(machineSetupOpened());
  store.dispatch(lastSshLoginLoaded(state === 'ssh-login' ? LOGIN : null));
  store.dispatch(sshDefaultsLoaded(state !== 'ssh-login-no-agent'));

  switch (state) {
    case 'pick':
    case 'pick-with-node':
      break;
    case 'paste':
      store.dispatch(machineSetupScreenShown('paste'));
      store.dispatch(pasteFieldOpened('wizard'));
      break;
    case 'paste-testing':
      store.dispatch(machineSetupScreenShown('paste'));
      store.dispatch(pasteFieldOpened('wizard'));
      store.dispatch(
        pasteTestingStarted(
          maskPairingUri('intent://pair?v=1&host=192.0.2.30&port=5180&fp=AA&token=secret-token'),
        ),
      );
      break;
    case 'paste-error':
      store.dispatch(machineSetupScreenShown('paste'));
      store.dispatch(pasteFieldOpened('wizard'));
      store.dispatch(pasteFailed({ code: 'unreachable', routes: ['192.0.2.30:5180'] }));
      break;
    case 'details':
      store.dispatch(machineSetupScreenShown('details'));
      break;
    case 'method':
      store.dispatch(machineSetupInstallPicked('backend'));
      store.dispatch(machineSetupScreenShown('method'));
      break;
    case 'manual-backend':
    case 'manual-node':
      store.dispatch(machineSetupInstallPicked(state === 'manual-node' ? 'node' : 'backend'));
      store.dispatch(machineSetupScreenShown('manual'));
      store.dispatch(pasteFieldOpened('wizard'));
      break;
    case 'ssh-login':
    case 'ssh-login-no-agent':
      store.dispatch(machineSetupScreenShown('sshLogin'));
      break;
    case 'ssh-login-password':
      store.dispatch(lastSshLoginLoaded({ ...LOGIN, method: 'password' }));
      store.dispatch(machineSetupScreenShown('sshLogin'));
      break;
    case 'ssh-connecting':
      run('connecting', []);
      break;
    case 'ssh-installing':
      run('installing');
      break;
    case 'ssh-host-key':
      run(
        'connecting',
        [],
      )({
        type: 'host-key',
        fingerprint: 'SHA256:pQ3x0rLm2V8n9aZcE1Yt7kWd4sHf6Uj5GbNq0RvTi2o',
        algorithm: 'ssh-ed25519',
      });
      break;
    case 'ssh-unreachable':
      fail('connecting', { code: 'unreachable' }, []);
      break;
    case 'ssh-auth-refused':
      fail('connecting', { code: 'auth-refused' }, []);
      break;
    case 'ssh-host-key-mismatch':
      fail(
        'connecting',
        {
          code: 'host-key-mismatch',
          fingerprint: 'SHA256:Zt8q1dS0o9fYk2bWc4Lx7nVa3eHu6Rj5PmGi0KsTy1w',
        },
        [],
      );
      break;
    case 'ssh-unsupported-os':
      fail('connecting', { code: 'unsupported-os', os: 'FreeBSD' }, []);
      break;
    case 'ssh-install-failed':
      fail('installing', { code: 'install-failed' }, [
        ...LOG.slice(0, 1),
        'install.sh: error: download failed: https://github.com/intent-hq/intentd-releases/releases/download/sitter-latest/intentd-x86_64-unknown-linux-musl.tar.xz',
      ]);
      break;
    case 'ssh-no-link':
      fail('pairing', { code: 'no-link' });
      break;
    case 'ssh-link-rejected':
      fail('adding', { code: 'link-rejected', addError: { code: 'unreachable' } });
      break;
    case 'ssh-existing-pairing':
    case 'ssh-existing-started':
    case 'ssh-existing-done': {
      const event = run('found', []);
      if (state === 'ssh-existing-started') event({ type: 'step', step: 'starting' });
      event({ type: 'step', step: 'pairing' });
      if (state === 'ssh-existing-done') store.dispatch(sshSetupDone(null, true));
      break;
    }
    case 'ssh-no-start':
      run('found', [])({ type: 'step', step: 'starting' });
      store.dispatch(sshSetupFailed({ step: 'starting', code: 'no-start' }));
      break;
    case 'ssh-did-not-start':
      run('found', [])({ type: 'step', step: 'starting' });
      store.dispatch(sshSetupFailed({ step: 'starting', code: 'did-not-start' }));
      break;
    case 'ssh-too-old':
    case 'ssh-orchestrator':
      run('found', [])({ type: 'step', step: 'pairing' });
      store.dispatch(
        sshSetupFailed({
          step: 'pairing',
          code: state === 'ssh-too-old' ? 'too-old' : 'orchestrator',
        }),
      );
      break;
    case 'ssh-done-linger':
      run('adding');
      store.dispatch(sshSetupDone('deploy', false));
      break;
  }

  return () => {
    store.dispatch(machineSetupClosed());
    store.dispatch(setLabsRemoteAgentsEnabled(previousLabs));
  };
}
