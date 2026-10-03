const { createRequire } = require('node:module');
const builderRequire = createRequire(require.resolve('electron-builder'));
const { getConfig } = builderRequire('app-builder-lib/out/util/config/config.js');

// Builder `extends` concatenates arrays, including protocols and extraResources.
// Resolve the original configuration first, then replace these two boundaries.
module.exports = async ({ projectDir }) => {
  const buildId = process.env.INTENT_ISOLATED_TEST_BUILD_ID;
  const backendSha = process.env.INTENT_ISOLATED_TEST_BACKEND_SHA;
  if (
    !/^manual-[1-9][0-9]{0,19}-[1-9][0-9]{0,2}$/.test(buildId || '') ||
    !/^[a-f0-9]{40}$/.test(backendSha || '')
  ) {
    throw new Error('Isolated package identity is missing or invalid');
  }
  const base = await getConfig(projectDir, 'electron-builder.yml', {});
  return {
    ...base,
    extends: null,
    appId: 'app.cloudlands.intent.gitlab-test',
    productName: 'Intent GitLab Test',
    protocols: [],
    publish: null,
    mac: {
      ...base.mac,
      extraResources: base.mac.extraResources.filter((entry) => entry.to !== 'keychain-helper'),
      extendInfo: {
        ...base.mac.extendInfo,
        IntentIsolatedTestBuild: buildId,
        IntentIsolatedTestBackend: backendSha,
      },
    },
  };
};
