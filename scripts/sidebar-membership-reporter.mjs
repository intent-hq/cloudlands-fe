import { writeFileSync } from 'node:fs';
import path from 'node:path';

// The native JSON reporter merges file suites by location.file, which can name
// a shared registration helper. Capture the unmerged file-suite title instead;
// it is assigned by native discovery relative to config.rootDir. Never derive IDs.
export default class SidebarMembershipReporter {
  version() {
    return 'v2';
  }

  onConfigure(config) {
    this.config = config;
    // Snapshot before execution-only plugins mutate metadata. --list skips them.
    this.configuredMetadata = structuredClone({
      root: config.metadata,
      projects: config.projects.map((project) => ({
        name: project.name,
        metadata: project.metadata,
      })),
    });
  }

  onBegin(suite) {
    const config = this.config;
    const cases = suite.allTests().map((test) => {
      const titlePath = [test.title];
      let parent = test.parent;
      while (parent?.type === 'describe') {
        titlePath.unshift(parent.title);
        parent = parent.parent;
      }
      if (parent?.type !== 'file') throw new Error('Missing native containing-file suite');
      return {
        id: test.id,
        file: path.resolve(config.rootDir, parent.title),
        titlePath,
        projectName: parent.project().name,
      };
    });
    writeFileSync(
      process.env.SIDEBAR_MEMBERSHIP_OUTPUT_FILE,
      JSON.stringify({
        schema: 1,
        rootDir: config.rootDir,
        workers: config.workers,
        configuredMetadata: this.configuredMetadata,
        cases,
      }),
      { flag: 'wx', mode: 0o600 },
    );
  }
}
