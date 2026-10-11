import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

function git(root, ...args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    throw new Error(`Cannot inspect checkout ${root}: ${error.stderr || error.message}`);
  }
}

function sourceTree(root, commit, sourcePaths) {
  const tree = git(root, "ls-tree", "-r", commit, "--", ...sourcePaths);
  if (!tree) throw new Error(`No reference sources at ${commit} in ${root}.`);
  return createHash("sha256").update(tree).digest("hex");
}

export function inspectReference(root, reference) {
  const checkout = git(root, "rev-parse", "--show-toplevel");
  const commit = git(root, "rev-parse", "HEAD");
  return {
    checkout,
    commit,
    sourceTreeSha256: sourceTree(root, commit, reference.sourcePaths),
    sourcePaths: reference.sourcePaths,
    dirtySources: git(
      root,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ...reference.sourcePaths,
    ),
  };
}

export function verifyReference(root, reference) {
  const inspected = inspectReference(root, reference);
  const pinnedTree = sourceTree(root, reference.commit, reference.sourcePaths);
  if (pinnedTree !== reference.sourceTreeSha256) {
    throw new Error(
      "The checked reference fingerprint does not match its commit. Review scene-manifest.json; no baseline was updated.",
    );
  }
  if (inspected.dirtySources) {
    throw new Error(
      `Reference sources have local changes in ${root}:\n${inspected.dirtySources}\nUse a clean independent Svelte checkout. No comparison was blessed.`,
    );
  }
  if (inspected.sourceTreeSha256 !== reference.sourceTreeSha256) {
    throw new Error(
      `Reference source drift: checked ${reference.commit}, checkout ${inspected.commit}. Run reference:inspect, review source/state changes, and explicitly update the manifest before comparing.`,
    );
  }
  return { ...inspected, reviewedCommit: reference.commit };
}

export function assertSourcePointers(root, manifest, candidateRoot) {
  if (
    sourceTree(root, manifest.reference.commit, manifest.reference.sourcePaths) !==
    manifest.reference.sourceTreeSha256
  ) {
    throw new Error("The checked manifest fingerprint does not match the pinned reference commit.");
  }
  const sources = new Set();
  for (const item of [...manifest.parity, ...manifest.functional]) {
    for (const source of item.referenceSources) sources.add(source);
  }
  for (const source of sources) {
    git(root, "cat-file", "-e", `${manifest.reference.commit}:${source}`);
  }
  if (candidateRoot) assertCandidatePointers(candidateRoot, manifest);
}

export function resolveCandidateRoot(root) {
  const resolved = realpathSync(path.resolve(root));
  if (realpathSync(git(resolved, "rev-parse", "--show-toplevel")) !== resolved)
    throw new Error(`Candidate root must be the checkout root: ${resolved}`);
  return resolved;
}

export function assertCandidatePointers(root, manifest) {
  const sources = new Set(
    [...manifest.parity, ...manifest.functional].flatMap((item) => item.candidateSources),
  );
  for (const source of sources) {
    const absolute = path.join(root, source);
    if (!statSync(absolute, { throwIfNoEntry: false })?.isFile())
      throw new Error(
        `Missing candidate source pointer ${source} in ${root}; the manifest cannot claim an unavailable component.`,
      );
    const relative = path.relative(root, realpathSync(absolute));
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(`Candidate source pointer escapes its declared checkout: ${source}`);
  }
}

const candidatePaths = [
  "apps/react",
  "src",
  "static",
  "messages",
  "project.inlang",
  "scripts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
];

export function candidateProvenance(root) {
  root = resolveCandidateRoot(root);
  const dirtyPaths = git(root, "status", "--porcelain=v1", "--untracked-files=all");
  const dirtySources = git(
    root,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...candidatePaths,
  );
  const files = git(
    root,
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...candidatePaths,
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const hashes = {};
  for (const file of files) {
    try {
      hashes[file] = createHash("sha256")
        .update(readFileSync(path.join(root, file)))
        .digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hashes[file] = "deleted";
    }
  }
  return {
    root,
    commit: git(root, "rev-parse", "HEAD"),
    dirty: Boolean(dirtyPaths),
    dirtyPaths,
    sourceDirty: Boolean(dirtySources),
    dirtySources,
    sourcePaths: candidatePaths,
    serverCheckoutAssociation: "operator-declared; no server attestation",
    checkout: git(root, "rev-parse", "--show-toplevel"),
    sourceSha256: hashes,
    sourceTreeSha256: createHash("sha256").update(JSON.stringify(hashes)).digest("hex"),
  };
}

export function changedSources(before, after) {
  return [...new Set([...Object.keys(before.sourceSha256), ...Object.keys(after.sourceSha256)])]
    .filter((file) => before.sourceSha256[file] !== after.sourceSha256[file])
    .sort();
}
