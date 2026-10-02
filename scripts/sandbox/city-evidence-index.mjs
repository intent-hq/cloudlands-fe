#!/usr/bin/env node
// node scripts/sandbox/city-evidence-index.mjs <output-directory> <run-directory>...
// Originals are never changed. Later completed attempts determine effective status.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [destination, ...directories] = process.argv.slice(2);
if (!destination || !directories.length) {
  throw new Error('Pass an output directory followed by the evidence run directories.');
}
const output = path.resolve(destination);
await mkdir(output, { recursive: true });
const runs = [];
const cases = new Map();
for (const directory of directories) {
  const filename = path.resolve(directory, 'results.json');
  const report = JSON.parse(await readFile(filename, 'utf8'));
  runs.push({
    report: path.relative(output, filename),
    command: report.command,
    startedAt: report.suiteStartedAt,
  });
  for (const result of report.results) {
    const attempt = {
      ...result,
      report: path.relative(output, filename),
      trace: path.relative(output, path.resolve(directory, result.trace)),
      video: result.video
        ? path.relative(output, path.resolve(directory, result.video))
        : undefined,
      screenshots: (result.screenshots ?? []).map((file) =>
        path.relative(output, path.resolve(directory, file)),
      ),
    };
    const attempts = cases.get(result.name) ?? [];
    attempts.push(attempt);
    cases.set(result.name, attempts);
  }
}
const scenarios = [...cases].map(([name, attempts]) => {
  attempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const latest = attempts.at(-1);
  return { name, status: latest.status, latest, attempts };
});
const index = {
  generatedAt: new Date().toISOString(),
  runs,
  passed: scenarios.filter((item) => item.status === 'passed').length,
  failed: scenarios.filter((item) => item.status !== 'passed').length,
  scenarios,
};
await writeFile(path.join(output, 'index.json'), JSON.stringify(index, null, 2));
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
const link = (file, label) =>
  `<a href="${file.split('/').map(encodeURIComponent).join('/')}">${escape(label)}</a>`;
const rows = scenarios
  .map(
    (item) =>
      `<tr><td>${escape(item.name)}</td><td>${escape(item.status)}</td><td>${item.attempts
        .map(
          (attempt, position) =>
            `<details><summary>Attempt ${position + 1}: ${escape(attempt.status)} · ${escape(attempt.startedAt)}</summary>${link(
              attempt.report,
              'Original report',
            )} · ${link(attempt.trace, 'Playwright trace')}${attempt.video ? ` · ${link(attempt.video, 'Motion video')}` : ''}<p>${attempt.screenshots
              .map((file) => link(file, path.basename(file)))
              .join(' · ')}</p>${
              attempt.error ? `<pre>${escape(attempt.error)}</pre>` : ''
            }</details>`,
        )
        .join('')}</td></tr>`,
  )
  .join('');
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>City browser evidence</title><style>body{font:16px system-ui;margin:2rem;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:.7rem}pre{white-space:pre-wrap;max-width:70vw}summary{cursor:pointer}</style><h1>City browser evidence</h1><p>${index.passed} scenarios pass; ${index.failed} fail in their latest recorded attempt. All original attempts remain linked, including failures.</p><p>Generated ${escape(index.generatedAt)}. ${link('index.json', 'Machine-readable index')}</p><table><thead><tr><th>Scenario</th><th>Latest result</th><th>Attempt history</th></tr></thead><tbody>${rows}</tbody></table></html>`,
);
console.log(`${index.passed} passed; ${index.failed} failed. Evidence index: ${output}`);
