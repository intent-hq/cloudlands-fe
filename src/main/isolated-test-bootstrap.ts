// Keep this the first dependency of index.ts. No application modules may initialize
// a store/client before these paths are established. This module imports only the
// generated build constants, Electron, Node, and the dependency-free profile policy.
import { app } from 'electron';
import { BUILD_CONFIG } from './build-config.generated.js';
import {
  activateIsolatedTestProfile,
  isolatedTestEnvironment,
  isIsolatedTestBuild,
  prepareIsolatedTestProfile,
} from './isolated-test-profile.js';

if (isIsolatedTestBuild()) {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    throw new Error('Isolated test packages require packaged macOS');
  }
  const profile = prepareIsolatedTestProfile(
    app.getPath('home'),
    BUILD_CONFIG.ISOLATED_TEST_BUILD_ID,
    BUILD_CONFIG.ISOLATED_TEST_BACKEND_SHA,
  );
  const environment = isolatedTestEnvironment(profile, process.env);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
  process.umask(0o077);
  app.setName('Intent GitLab Test');
  app.setPath('home', profile.home);
  app.setPath('appData', profile.root);
  app.setPath('userData', profile.userData);
  app.setPath('sessionData', `${profile.root}/sessions`);
  app.setPath('temp', `${profile.root}/tmp`);
  app.setPath('logs', `${profile.root}/logs`);
  activateIsolatedTestProfile(profile);
}
