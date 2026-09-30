// Setup phase only. Never imported by the network-disabled workload.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const plan = JSON.parse(await readFile(new URL('./plan.json', import.meta.url)));
export function checkRelease(release, tag, asset) {
  const c = plan.candidate;
  if (
    release.id !== c.releaseId ||
    release.draft ||
    release.tag_name !== `v${c.version}` ||
    tag.sha !== c.commit ||
    asset.id !== c.assetId ||
    asset.name !== c.name ||
    asset.size !== c.bytes ||
    asset.digest !== `sha256:${c.sha256}` ||
    !release.assets.some((a) => a.id === asset.id && a.digest === asset.digest)
  )
    throw new Error('candidate publication identity mismatch');
}
async function acquire(out) {
  const c = plan.candidate;
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  async function json(path) {
    const r = await fetch(`https://api.github.com/repos/${c.repo}/${path}`, {
      headers,
      signal: globalThis.AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`metadata ${r.status}`);
    return r.json();
  }
  const release = await json(`releases/${c.releaseId}`);
  const tag = await json(`commits/v${c.version}`);
  const asset = await json(`releases/assets/${c.assetId}`);
  checkRelease(release, tag, asset);
  const r = await fetch(`https://api.github.com/repos/${c.repo}/releases/assets/${c.assetId}`, {
    headers: { ...headers, Accept: 'application/octet-stream' },
    signal: globalThis.AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`asset ${r.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > c.bytes) throw new Error('asset byte bound');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (size !== c.bytes || sha256 !== c.sha256) throw new Error('asset content mismatch');
  await mkdir(out, { recursive: false, mode: 0o700 });
  await writeFile(`${out}/${c.name}`, bytes, { flag: 'wx', mode: 0o400 });
  await writeFile(
    `${out}/publication.json`,
    JSON.stringify({ release, tag, asset, sha256, size }, null, 2),
    { flag: 'wx', mode: 0o400 },
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await acquire(process.argv[2]);
