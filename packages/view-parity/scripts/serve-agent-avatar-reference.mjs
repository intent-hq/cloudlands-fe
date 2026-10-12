#!/usr/bin/env node
// Preparation: plan only reads the pinned checkout and writes an ignored receipt.
// After review: serve rechecks that receipt, then starts one isolated native fixture.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(import.meta.url);
const workspace = path.resolve(path.dirname(script), "../../..");
const fixture = path.resolve(path.dirname(script), "../fixtures/agent-avatar-source");
const evidenceRoot = path.join(workspace, ".demo-artifacts/view-parity/agent-avatar-source-mount");
const commit = "003bc52c00dcfffe8513cd6be1b8f45011716714";
const treeHash = "f0d948e47d2bcb218e263bc60672611fe3fb4713164d696188e3ee3ed883df4f";
const sourcePaths = [
  "src",
  "static",
  "messages",
  "project.inlang",
  "scripts",
  "package.json",
  "pnpm-lock.yaml",
  ".npmrc",
  "vite.config.mjs",
  "svelte.config.js",
  "tailwind.config.js",
  "postcss.config.mjs",
  "tsconfig.json",
  "pnpm-workspace.yaml",
];
const avatar = "src/features/agent/components/agent-avatar/";
const host = `${avatar}__tests__/AgentAvatarWaitingHost.svelte`;
const sourcePins = {
  [host]: "abf14362895e5a4be830df32d997b4483985135edd61fbbea6e626d47d7b7e36",
  [`${avatar}AgentAvatarCatalog.svelte`]:
    "dce360d7c93e838f80a309971b3de6f4feda1ca4dbc18a94ad871029279af35a",
};
const allowedSource = new Set([
  host,
  ...[
    "AgentAvatarCatalog.svelte",
    "AgentAvatar.svelte",
    "AgentAvatarArt.svelte",
    "AgentAvatarWithState.svelte",
    "AgentAvatarStack.svelte",
    "agent-avatar.catalog.ts",
    "avatar-design.ts",
    "avatar-size.ts",
    "avatar-stack-fit.ts",
    "avatar-state-label.ts",
  ].map((name) => `${avatar}${name}`),
  "src/lib/utils/hash.ts",
  "src/lib/i18n/format.ts",
  "src/lib/i18n/locale.ts",
  "src/shared/i18n/formatters.ts",
  "src/shared/i18n/locale-matcher.ts",
]);
const styles = [
  "src/app.css",
  ...[
    "tokens",
    "overlay-surface",
    "tiptap-editor",
    "chat-messages",
    "comments",
    "resize-handles",
  ].map((name) => `src/lib/styles/${name}.css`),
];
const toolSpecifiers = [
  "vite",
  "@sveltejs/vite-plugin-svelte",
  "svelte/compiler",
  "typescript",
  "@tailwindcss/postcss",
  "autoprefixer",
  "tailwindcss",
  "@tailwindcss/typography",
  "date-fns",
  "@fontsource-variable/inter/index.css",
  "@fontsource-variable/source-serif-4/index.css",
];
const bridgeKeys = ["INTENT_DEV_DAEMON_BRIDGE", "VITE_INTENTD_WS_URL"];
const route = "/agent-avatar-source";
const entryUrl = "/agent-avatar-source-entry.mjs";
const virtualId = "virtual:agent-avatar-source-provenance";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = (file) => digest(readFileSync(file));
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function filesIn(root) {
  return readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((item) => {
      const file = path.join(root, item.name);
      if (item.isSymbolicLink()) throw new Error(`Unexpected symlink in hashed package: ${file}`);
      return item.isDirectory() ? filesIn(file) : [file];
    });
}

function installedPackage(reference, resolve, specifier) {
  const entry = realpathSync(resolve(specifier));
  const name = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  let root = path.dirname(entry);
  while (root !== path.dirname(root)) {
    const file = path.join(root, "package.json");
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === name) break;
    root = path.dirname(root);
  }
  if (!inside(path.join(reference, "node_modules"), root)) {
    throw new Error(
      `Dependency ${specifier} is not independently installed in the reference checkout.`,
    );
  }
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const hashes = filesIn(root).map((file) => [path.relative(root, file), fileHash(file)]);
  return {
    name,
    version: manifest.version,
    entry,
    root,
    files: hashes.length,
    sha256: digest(JSON.stringify(hashes)),
  };
}

function sourceClosure(reference, require) {
  const compiler = require("svelte/compiler");
  const ts = require("typescript");
  const hashes = {};
  const imports = {};
  const bare = new Set();
  function visit(file) {
    const relative = path.relative(reference, realpathSync(file));
    if (hashes[relative]) return;
    const generated =
      /^src\/shared\/paraglide\/(?:runtime\.js|messages\.js|messages\/[\w.-]+\.js)$/.test(relative);
    if (!allowedSource.has(relative) && !generated)
      throw new Error(`Unreviewed source import: ${relative}`);
    hashes[relative] = fileHash(file);
    let code = readFileSync(file, "utf8");
    if (file.endsWith(".svelte")) {
      code = compiler.compile(code, {
        filename: file,
        generate: "client",
        dev: true,
        compatibility: { componentApi: 4 },
      }).js.code;
    } else if (file.endsWith(".ts")) {
      code = ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
      }).outputText;
    }
    imports[relative] = ts
      .preProcessFile(code, true, true)
      .importedFiles.map((item) => item.fileName)
      .sort();
    for (const specifier of imports[relative]) {
      let target;
      if (specifier.startsWith("$lib/"))
        target = path.join(reference, "src/lib", specifier.slice(5));
      else if (specifier.startsWith("$shared/"))
        target = path.join(reference, "src/shared", specifier.slice(8));
      else if (specifier.startsWith(".")) target = path.resolve(path.dirname(file), specifier);
      else if (/^(?:svelte(?:\/.*)?|date-fns(?:\/locale)?)$/.test(specifier)) {
        bare.add(specifier);
        continue;
      } else throw new Error(`Unreviewed external import ${specifier} in ${relative}`);
      const resolved = [target, `${target}.ts`, `${target}.js`].find((candidate) =>
        statSync(candidate, { throwIfNoEntry: false })?.isFile(),
      );
      if (!resolved) throw new Error(`Missing source import ${specifier} in ${relative}`);
      visit(resolved);
    }
  }
  visit(path.join(reference, host));
  return { hashes, imports, bare: [...bare].sort() };
}

function inspect(reference, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5175)
    throw new Error("Choose a valid separate unprivileged port; original5175 is reserved.");
  if (bridgeKeys.some((key) => process.env[key]))
    throw new Error(`Unset ${bridgeKeys.join(" and ")} before preparing or serving this fixture.`);
  const root = realpathSync(reference);
  if (root !== realpathSync(git(root, "rev-parse", "--show-toplevel")))
    throw new Error("Reference must be the exact checkout root.");
  if (git(root, "rev-parse", "HEAD") !== commit)
    throw new Error(`Reference must remain at original ${commit}.`);
  if (git(root, "status", "--porcelain=v1", "--untracked-files=all", "--", ...sourcePaths))
    throw new Error("Reference source/config paths are dirty.");
  if (digest(git(root, "ls-tree", "-r", commit, "--", ...sourcePaths)) !== treeHash)
    throw new Error("Reference source fingerprint does not match original003.");
  for (const [file, hash] of Object.entries(sourcePins)) {
    if (fileHash(path.join(root, file)) !== hash) throw new Error(`Pinned source changed: ${file}`);
  }
  const modules = path.join(root, "node_modules");
  if (!lstatSync(modules).isDirectory() || realpathSync(modules) !== modules)
    throw new Error("Reference node_modules must be its own real directory.");
  const lock = fileHash(path.join(root, "pnpm-lock.yaml"));
  if (fileHash(path.join(modules, ".pnpm/lock.yaml")) !== lock)
    throw new Error("Installed reference dependencies do not match the frozen lockfile.");
  const require = createRequire(path.join(root, "package.json"));
  const packages = toolSpecifiers.map((item) => installedPackage(root, require.resolve, item));
  const svelteRequire = createRequire(
    path.join(packages.find((item) => item.name === "svelte").root, "package.json"),
  );
  for (const item of ["clsx", "esm-env"])
    packages.push(installedPackage(root, svelteRequire.resolve, item));
  const closure = sourceClosure(root, require);
  const inputs = [
    "project.inlang/settings.json",
    ...readdirSync(path.join(root, "messages"))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => `messages/${file}`),
  ];
  const inputHash = createHash("sha256");
  for (const file of inputs)
    inputHash
      .update(path.basename(file))
      .update("\0")
      .update(readFileSync(path.join(root, file)))
      .update("\0");
  const paraglideInputsSha256 = inputHash.digest("hex");
  if (
    readFileSync(path.join(root, "src/shared/paraglide/.inputs.sha256"), "utf8").trim() !==
    paraglideInputsSha256
  )
    throw new Error("Generated reference Paraglide is stale; preparation will not regenerate it.");
  const auxiliary = [
    ...styles,
    "test/test-fonts.ts",
    "src/routes/sandbox/+layout.svelte",
    "src/shared/paraglide/.inputs.sha256",
  ];
  const setupFiles = [script, path.join(fixture, "index.html"), path.join(fixture, "entry.mjs")];
  return {
    schemaVersion: 1,
    reference: { root, commit, sourceTreeSha256: treeHash, sourcePaths },
    host,
    sourcePins,
    closure,
    auxiliarySha256: Object.fromEntries(
      auxiliary.map((file) => [file, fileHash(path.join(root, file))]),
    ),
    dependencies: {
      lockSha256: lock,
      modulesSha256: fileHash(path.join(modules, ".modules.yaml")),
      packages,
    },
    paraglideInputsSha256,
    setupSha256: Object.fromEntries(
      setupFiles.map((file) => [path.relative(workspace, file), fileHash(file)]),
    ),
    runtime: {
      host: "127.0.0.1",
      port,
      route,
      cwd: root,
      tailwindBase: root,
      postcss: ["@tailwindcss/postcss", "autoprefixer"],
      configFile: false,
      envFile: false,
      props: { theme: "light", motionReduced: true, state: "waiting", zoom: 1 },
      viewport: { width: 1024, height: 900 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "UTC",
      ready: '[data-avatar-source-ready="true"]',
      crop: '[data-testid="source-avatar-waiting-host"]',
      fontSetupSources: ["test/test-fonts.ts", "src/routes/sandbox/+layout.svelte"],
      noStore: true,
      noAppBootstrap: true,
      noBridge: true,
      noMocks: true,
    },
  };
}

async function serve(planFile) {
  const file = realpathSync(planFile);
  if (!inside(evidenceRoot, file) || path.basename(file) !== "plan.json")
    throw new Error("Serve requires an ignored avatar-source plan.json receipt.");
  const plan = JSON.parse(readFileSync(file, "utf8"));
  const inspected = inspect(plan.input.reference.root, plan.input.runtime.port);
  if (JSON.stringify(inspected) !== JSON.stringify(plan.input))
    throw new Error(
      "Source, dependencies or maintained fixture changed after preparation; review a new plan.",
    );
  if (digest(JSON.stringify(plan.input)) !== plan.inputSha256)
    throw new Error("Plan fingerprint mismatch.");
  const runDir = path.dirname(file);
  const runFile = path.join(runDir, "run.json");
  if (existsSync(runFile))
    throw new Error(
      "This plan has already been used; prepare a new reviewed receipt for another launch.",
    );
  const root = inspected.reference.root;
  process.chdir(root);
  const dependency = (name) => inspected.dependencies.packages.find((item) => item.name === name);
  const [
    { createServer },
    { svelte, vitePreprocess },
    { default: tailwind },
    { default: autoprefixer },
  ] = await Promise.all([
    import(pathToFileURL(dependency("vite").entry)),
    import(pathToFileURL(dependency("@sveltejs/vite-plugin-svelte").entry)),
    import(pathToFileURL(dependency("@tailwindcss/postcss").entry)),
    import(pathToFileURL(dependency("autoprefixer").entry)),
  ]);
  const cacheDir = path.join(runDir, "vite-cache");
  const entry = path.join(fixture, "entry.mjs");
  const allowedFiles = new Set([
    ...Object.keys(inspected.closure.hashes).map((name) => path.join(root, name)),
    ...styles.map((name) => path.join(root, name)),
    entry,
  ]);
  const packageRoots = inspected.dependencies.packages.map((item) => item.root);
  const browserProvenance = {
    commit,
    sourceTreeSha256: treeHash,
    planSha256: plan.inputSha256,
    host,
    sourcePins,
    root,
    tailwindBase: root,
  };
  const nativeFixture = {
    name: "isolated-agent-avatar-source",
    enforce: "pre",
    resolveId(id) {
      if (id === virtualId) return `\0${virtualId}`;
      if (id === entryUrl) return entry;
    },
    load(id) {
      if (id === `\0${virtualId}`) return `export default ${JSON.stringify(browserProvenance)};`;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          if (!["GET", "HEAD"].includes(request.method)) {
            response.writeHead(405).end();
            return;
          }
          const url = new URL(request.url, "http://127.0.0.1");
          const pathname = decodeURIComponent(url.pathname);
          if (pathname === route) {
            response.setHeader("Content-Type", "text/html");
            response.setHeader("Cache-Control", "no-store");
            response.end(
              await server.transformIndexHtml(
                route,
                readFileSync(path.join(fixture, "index.html"), "utf8"),
              ),
            );
            return;
          }
          if (
            [entryUrl, "/@vite/client", "/@vite/env", `/@id/__x00__${virtualId}`].includes(pathname)
          ) {
            next();
            return;
          }
          const target = pathname.startsWith("/@fs/")
            ? pathname.slice(4)
            : path.join(root, pathname);
          const actual = existsSync(target) ? realpathSync(target) : target;
          if (
            allowedFiles.has(actual) ||
            inside(cacheDir, actual) ||
            packageRoots.some((dir) => inside(dir, actual))
          ) {
            next();
            return;
          }
          response.writeHead(404).end("Only the reviewed avatar source fixture is served.");
        } catch (error) {
          next(error);
        }
      });
    },
  };
  const server = await createServer({
    root,
    configFile: false,
    envFile: false,
    publicDir: false,
    appType: "custom",
    cacheDir,
    envPrefix: "AVATAR_SOURCE_UNUSED_",
    plugins: [
      nativeFixture,
      svelte({
        configFile: false,
        preprocess: vitePreprocess(),
        compilerOptions: { compatibility: { componentApi: 4 } },
        hot: false,
        inspector: false,
        prebundleSvelteLibraries: false,
      }),
    ],
    resolve: {
      alias: { $lib: path.join(root, "src/lib"), $shared: path.join(root, "src/shared") },
      dedupe: inspected.dependencies.packages.map((item) => item.name),
    },
    css: { postcss: { plugins: [tailwind({ base: root }), autoprefixer()] } },
    optimizeDeps: {
      noDiscovery: true,
      entries: [],
      include: ["svelte", ...inspected.closure.bare],
    },
    server: {
      host: "127.0.0.1",
      port: inspected.runtime.port,
      strictPort: true,
      hmr: false,
      watch: null,
      fs: { strict: true, allow: [root, fixture, cacheDir] },
    },
  });
  const receipt = {
    planSha256: plan.inputSha256,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    tailwindBase: root,
    url: plan.url,
    status: "starting",
  };
  const writeReceipt = () => writeFileSync(runFile, `${JSON.stringify(receipt, null, 2)}\n`);
  writeReceipt();
  let stopping = false;
  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    await server.close();
    try {
      if (JSON.stringify(inspect(root, inspected.runtime.port)) !== JSON.stringify(inspected))
        throw new Error("Source, dependencies or fixture changed during serving.");
      receipt.status = "stopped";
    } catch (error) {
      receipt.status = "drift";
      receipt.error = error.message;
      process.exitCode = 1;
    }
    receipt.stoppedAt = new Date().toISOString();
    receipt.signal = signal;
    writeReceipt();
  }
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
  try {
    await server.listen();
    receipt.status = "listening";
    writeReceipt();
  } catch (error) {
    await server.close();
    receipt.status = "failed";
    receipt.error = error.message;
    writeReceipt();
    throw error;
  }
  console.log(
    JSON.stringify(
      {
        ...receipt,
        runFile,
        note: "Listening is not browser readiness; verify the ready marker and font receipt.",
      },
      null,
      2,
    ),
  );
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" && !args.length) {
    console.log(`Avatar source mount (original003 only; no installation or source generation).
Preparation only:
  node ${script} plan --reference-root /tmp/intent-view-parity-reference-003bc52 --port 5344
After reviewing the printed plan:
  node ${script} serve --plan <absolute ignored plan.json>
Stop only this process with Ctrl-C or kill -TERM <pid from its run.json>.
Plan performs no server/browser launch. Serve uses the reference checkout as cwd and Tailwind scan base.
Only ${route}?theme=light&motion=reduced&state=waiting&zoom=1 is reviewed.
Use a 1024x900, DPR1, en-US, UTC, light/reduced browser. Readiness includes actual loaded Inter Variable faces.
Receipts and the isolated optimizer cache remain under ${evidenceRoot}.`);
    return;
  }
  const allowed =
    command === "plan" ? ["--reference-root", "--port"] : command === "serve" ? ["--plan"] : [];
  if (!allowed.length) throw new Error(`Unknown command: ${command}. Use help.`);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !allowed.includes(args[i]) ||
      options[args[i]] ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error(`Invalid or duplicate option: ${args[i]}`);
    options[args[i]] = args[i + 1];
  }
  if (command === "serve") {
    if (!options["--plan"])
      throw new Error("Serve requires --plan. Review a prepared receipt first.");
    await serve(options["--plan"]);
    return;
  }
  if (!options["--reference-root"]) throw new Error("Plan requires --reference-root.");
  const port = Number(options["--port"] || "5344");
  const input = inspect(options["--reference-root"], port);
  mkdirSync(evidenceRoot, { recursive: true });
  const directory = mkdtempSync(path.join(evidenceRoot, "plan-"));
  const planFile = path.join(directory, "plan.json");
  const plan = {
    preparedAt: new Date().toISOString(),
    status: "prepared-not-launched",
    input,
    inputSha256: digest(JSON.stringify(input)),
    url: `http://127.0.0.1:${port}${route}?theme=light&motion=reduced&state=waiting&zoom=1`,
    start: `env -u INTENT_DEV_DAEMON_BRIDGE -u VITE_INTENTD_WS_URL node ${shellQuote(script)} serve --plan ${shellQuote(planFile)}`,
    stop: "Ctrl-C in the owned terminal, or kill -TERM the pid recorded in this plan directory's run.json; never stop a different listener.",
    cacheDir: path.join(directory, "vite-cache"),
    unrun: [
      "dependency installation (existing frozen local installation inspected)",
      "server launch",
      "browser readiness/fonts",
      "paired capture",
    ],
  };
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        planFile,
        inputSha256: plan.inputSha256,
        url: plan.url,
        start: plan.start,
        stop: plan.stop,
        status: plan.status,
        sourceFiles: Object.keys(input.closure.hashes).length,
        dependencies: input.dependencies.packages.map(({ name, version }) => ({ name, version })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`Avatar source setup: ${error.message}`);
  process.exitCode = 1;
});
