// @verify-changed-triggers: vitest.config.ts, apps/react/vitest.config.ts
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('applies the root worker budget to both renderer projects', () => {
  // Resolve through the installed runner in a separate process. Importing the
  // config alone misses CLI inheritance and cannot catch incompatible groups.
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import { createVitest } from 'vitest/node';
        const runner = await createVitest('test', {
          config: 'vitest.config.ts', maxWorkers: 2, watch: false, run: true,
        });
        try {
          console.log(JSON.stringify(runner.projects.map(project => ({
            name: project.name,
            maxWorkers: project.config.maxWorkers ?? runner.config.maxWorkers,
            groupOrder: project.config.sequence.groupOrder,
          })).sort((a, b) => a.name.localeCompare(b.name))));
        } finally {
          await runner.close();
        }
      `,
    ],
    { encoding: 'utf8' },
  );
  expect(JSON.parse(output)).toEqual([
    { name: 'react', maxWorkers: 2, groupOrder: 0 },
    { name: 'source', maxWorkers: 2, groupOrder: 0 },
  ]);
});
