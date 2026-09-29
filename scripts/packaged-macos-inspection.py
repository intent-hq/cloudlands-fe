#!/usr/bin/env python3
"""Read-only package inspection. Never starts bundled code or a daemon.

Publication and a single hosted invocation require separate approval. The product
is immutable; the controller is the new PR head, NOT the product or merge SHA.
All native interfaces are injectable so preparation tests need no native effects.
"""

import contextlib
import hashlib
import json
import os
import pathlib
import platform
import plistlib
import re
import selectors
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zipfile

PRODUCT = "13a6cbe92681f7e3f6858ad7d5ce414375935b2c"
REPO = "intent-hq/cloudlands-fe"
BRANCH = "diagnostic/b76t-packaged-readiness"
WORKFLOW = ".github/workflows/packaged-macos-inspection.yml"
CONTROLLER = "scripts/packaged-macos-inspection.py"
BUILD = 36600807651
ARTIFACT = 11049821412
ZIP_BYTES = 219976198
ZIP_SHA = "456605a944e352625be3280704f875a3b73d48c8789235da3faae8c7ba68251a"
DMG_NAME = "Intent-2.189.0-manual.111-arm64.dmg"
DMG_BYTES = 220446173
DMG_SHA = "9da515ceb2552a869942a2ea039bdcfaed77d5d1bc94d5610015c9a37ca7703b"
CERT_SHA1 = "C35B33D77B4E5B56A4B72FF0E00714EDD19A4EF7"
ZIP_CAP = 234881024
EXPANDED_CAP = 268435456
RETAINED_CAP = 536870912
LOG_CAP = 33554432
UPLOAD_CAP = 67108864
# Partition, rather than increase, LOG_CAP. Ordinary streams cannot consume
# command results, detach evidence, or the terminal/manifest allocation.
RECEIPT_LIMITS = dict(normal=22 * 1024**2, command=4 * 1024**2,
                      cleanup=4 * 1024**2, final=2 * 1024**2)
RESULT_SLOT = 16384
PHASES = dict(nativeReadiness=30, metadata=30, zipTransfer=60,
              centralDirectory=30, selectedExtraction=60, dmgVerify=60,
              attach=30, bundleInventory=300, nativeSignatureAndArchitecture=180,
              ticketAndAssessment=120, detach=30, finalize=30, upload=180)
TOOLS = {"git": "/usr/bin/git", "hdiutil": "/usr/bin/hdiutil",
         "plutil": "/usr/bin/plutil", "lipo": "/usr/bin/lipo",
         "otool": "/usr/bin/otool", "codesign": "/usr/bin/codesign",
         "xcrun": "/usr/bin/xcrun", "spctl": "/usr/sbin/spctl"}
MACH_MAGIC = {bytes.fromhex(s) for s in
              ("feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca")}


class Stop(Exception):
    def __init__(self, message, code=1, outcome=None):
        super().__init__(message)
        self.code = code
        self.outcome = outcome


def require(condition, message):
    if not condition:
        raise Stop(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def identity(path):
    s = pathlib.Path(path).lstat()
    return dict(dev=s.st_dev, inode=s.st_ino, uid=s.st_uid, gid=s.st_gid,
                mode=stat.S_IMODE(s.st_mode), size=s.st_size)


def digest_file(path, cap, tick=lambda: None):
    h = hashlib.sha256()
    total = 0
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            tick()
            total += len(chunk)
            require(total <= cap, "file byte cap")
            h.update(chunk)
    return total, h.hexdigest()


def verify_bytes(size, digest, expected_size, expected_digest):
    require(size == expected_size and digest == expected_digest, "size/digest mismatch")


def member_inventory(infos):
    require(0 < len(infos) <= 256, "member count")
    names = set()
    rows = []
    total = 0
    for i in infos:
        p = pathlib.PurePosixPath(i.filename)
        mode = i.external_attr >> 16
        require(i.filename and "\\" not in i.filename and not p.is_absolute()
                and all(s not in ("", ".", "..") for s in i.filename.split("/")), "unsafe member path")
        require(i.filename == DMG_NAME and i.filename not in names, "unexpected/duplicate member")
        require(not i.is_dir() and stat.S_IFMT(mode) == stat.S_IFREG
                and not (i.flag_bits & 1), "member type/encryption")
        require(i.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "compression")
        total += i.file_size
        require(total <= EXPANDED_CAP and i.file_size == DMG_BYTES, "expanded bound")
        names.add(i.filename)
        rows.append(dict(name=i.filename, size=i.file_size, compressed=i.compress_size,
                         crc32=f"{i.CRC:08x}", mode=mode, flags=i.flag_bits))
    require(names == {DMG_NAME}, "missing DMG")
    return rows


def route(event, env, merge, parents, tree, controller_tree, workflow_equal, source_equal):
    pr = event["pull_request"]
    head = pr["head"]["sha"]
    require(env["GITHUB_EVENT_NAME"] == "pull_request" and event["action"] == "synchronize", "event")
    require(event["number"] == 2977 and pr["number"] == 2977 and pr["draft"] is True
            and pr["state"] == "open", "PR disposition")
    require(event["repository"]["full_name"] == REPO
            and pr["head"]["repo"]["full_name"] == REPO
            and pr["base"]["repo"]["full_name"] == REPO, "repository")
    require(pr["head"]["ref"] == BRANCH and event["before"] == PRODUCT
            and event["after"] == head and head != PRODUCT, "one-use head transition")
    require(re.fullmatch("[0-9a-f]{40}", head) and env["GITHUB_RUN_ATTEMPT"] == "1", "head/attempt")
    require(env["GITHUB_REF"] == "refs/pull/2977/merge"
            and env["GITHUB_SHA"] == merge and env["WORKFLOW_SHA"] == merge, "workflow/event/checkout")
    require(env["WORKFLOW_REF"] == f"{REPO}/{WORKFLOW}@refs/pull/2977/merge", "workflow ref")
    require(len(parents) == 2 and parents[1] == head, "merge parents")
    require(workflow_equal and source_equal, "controller/merge control source equality")
    require(env["RUNNER_ENVIRONMENT"] == "github-hosted" and env["RUNNER_OS"] == "macOS"
            and env["RUNNER_ARCH"] == "ARM64", "runner route")
    return dict(product=PRODUCT, controller=head, merge=merge, mergeTree=tree, controllerTree=controller_tree,
                actualMergeBase=parents[0], eventBase=pr["base"]["sha"],
                run=env["GITHUB_RUN_ID"], attempt=1, workflowSha=env["WORKFLOW_SHA"],
                workflowRef=env["WORKFLOW_REF"], previous=event["before"])


def mount_record(info, mount, dmg, entities):
    """Use native image identity. Never derive a disk number from a mount name."""
    matches = [i for i in info.get("images", []) if i.get("image-path") == str(dmg)]
    require(len(matches) == 1, "backing image ambiguity")
    image = matches[0]
    require(image.get("writeable") is False, "image not read-only")
    live = image.get("system-entities", [])
    require(live == entities, "attach/info entities differ")
    mounted = [e for e in live if e.get("mount-point")]
    require(len(mounted) == 1 and mounted[0]["mount-point"] == str(mount), "mount ownership")
    devices = [e.get("dev-entry", "") for e in live]
    require(devices and all(re.fullmatch(r"/dev/disk[0-9]+(?:s[0-9]+)*", d) for d in devices), "device identity")
    roots = [d for d in devices if re.fullmatch(r"/dev/disk[0-9]+", d)]
    require(len(roots) == 1 and all(d == roots[0] or d.startswith(roots[0] + "s") for d in devices), "device family")
    return dict(backing=str(dmg), entities=live, device=roots[0], readonly=True)


def settle(primary, cleanup):
    """First failure wins; cleanup remains a separate, mandatory result."""
    return primary or cleanup or 0


class Evidence:
    def __init__(self, root):
        self.root = pathlib.Path(root)
        self.receipts = self.root / "receipts"
        self.receipts.mkdir(mode=0o700)
        self.charged = {key: 0 for key in RECEIPT_LIMITS}
        self.terminal_slot = self.reserve(65536, "final")
        self.manifest_slot = self.reserve(RECEIPT_LIMITS["final"] - 131072, "final")
        self.final_slot = self.reserve(65536, "final")

    @property
    def bytes(self):
        return sum(self.charged.values())

    def reserve(self, size, bucket):
        require(0 <= size <= RECEIPT_LIMITS[bucket] - self.charged[bucket], bucket + " evidence cap")
        self.charged[bucket] += size
        return dict(bucket=bucket, bytes=size, used=False)

    def release(self, ticket):
        if ticket is not None and not ticket["used"]:
            self.charged[ticket["bucket"]] -= ticket["bytes"]
            ticket["used"] = True

    def write(self, name, value, *, bucket="normal", ticket=None):
        data = (json.dumps(value, indent=2, ensure_ascii=True) + "\n").encode()
        ticket = self.reserve(len(data), bucket) if ticket is None else ticket
        require(not ticket["used"] and len(data) <= ticket["bytes"], "reserved receipt size")
        ticket["used"] = True
        p = self.receipts / name
        with p.open("xb") as f:
            require(f.write(data) == len(data), "short receipt write")
            f.flush()
            os.fsync(f.fileno())
        # Refund only after a complete successful write/flush/sync/close.
        # Failed writes retain their full reservation conservatively.
        self.charged[ticket["bucket"]] -= ticket["bytes"] - len(data)
        return p


class Native:
    """Only fixed native tools; streamed private files, no shell or inherited secrets."""
    def __init__(self, evidence):
        self.e = evidence
        self.deadline = None
        self.phase_name = None
        self.n = 0
        self.unsettled = False
        self.last_failure = None
        self.env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
                    "LANG": "C", "LC_ALL": "C", "TMPDIR": str(evidence.root)}
        self.gh = shutil.which("gh")
        require(self.gh and pathlib.Path(self.gh).is_absolute(), "gh unavailable")
        self.gh_config = self.e.root / "private-gh-config"
        self.gh_config.mkdir(mode=0o700)

    @contextlib.contextmanager
    def phase(self, name):
        self.phase_name = name
        self.deadline = time.monotonic() + PHASES[name]
        try:
            yield
            self.tick()
        finally:
            self.deadline = None
            self.phase_name = None

    def tick(self):
        require(self.deadline is not None and time.monotonic() < self.deadline, "phase deadline")

    def run(self, argv, *, token=None, binary=False):
        self.tick()
        require(not self.unsettled, "prior native invocation is unresolved")
        require(argv[0] in set(TOOLS.values()) | {self.gh}, "unapproved executable")
        self.n += 1
        name = f"{self.n:04d}"
        directory = self.e.root if binary else self.e.receipts
        out = directory / f"{name}.stdout"
        err = self.e.receipts / f"{name}.stderr"
        bucket = "cleanup" if self.phase_name == "detach" else "normal"
        receipt_bucket = "cleanup" if bucket == "cleanup" else "command"
        cap = ZIP_CAP if binary else 8 * 1024 * 1024
        env = dict(self.env)
        if token is not None:
            require(argv[0] == self.gh, "token only for artifact read client")
            env["GH_TOKEN"] = token
            env["GH_CONFIG_DIR"] = str(self.gh_config)
            env["GH_HOST"] = "github.com"
            env["GH_PROMPT_DISABLED"] = "1"
        counts = [0, 0]
        hashes = [hashlib.sha256(), hashlib.sha256()]
        eof = [False, False]
        proc = None
        native_exit = None
        cleanup_exit = None
        direct_reaped = False
        capture_error = None
        capture_code = 0
        final_errors = []
        settlement_errors = []
        files = []
        selector = None
        start_slot = result_slot = None
        terminated = False
        sync_ok = [False, False]
        short_error = lambda exc: (type(exc).__name__ + ": " + str(exc))[:1024]
        try:
            # Reserve both records BEFORE launch, including when normal capture
            # is already at its limit. A failed intent never launches a child.
            result_slot = self.e.reserve(RESULT_SLOT, receipt_bucket)
            start_slot = self.e.reserve(RESULT_SLOT, receipt_bucket)
            self.e.write(name + "-intent.json", dict(argv=argv, started=time.time(), binary=binary), bucket=bucket)
            for p in (out, err):
                files.append(p.open("xb"))
            selector = selectors.DefaultSelector()
            proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            self.unsettled = True
            self.e.write(name + "-start.json", dict(pid=proc.pid, started=time.time()), ticket=start_slot)
            for i, pipe in enumerate((proc.stdout, proc.stderr)):
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, i)
            while selector.get_map():
                self.tick()
                for key, _ in selector.select(min(0.1, max(0, self.deadline - time.monotonic()))):
                    i = key.data
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        eof[i] = True
                        selector.unregister(key.fileobj)
                        continue
                    require(counts[i] + len(chunk) <= (cap if i == 0 else 1024 * 1024), "stream cap")
                    if not (binary and i == 0):
                        self.e.reserve(len(chunk), bucket)["used"] = True
                    written = files[i].write(chunk)
                    if isinstance(written, int) and 0 <= written <= len(chunk):
                        hashes[i].update(chunk[:written])
                        counts[i] += written
                    require(written == len(chunk), "short stream write")
            waited = proc.wait(timeout=max(0.001, self.deadline - time.monotonic()))
            require(type(waited) is int, "nonconclusive native wait")
            native_exit = waited
            direct_reaped = True
            self.unsettled = False
        except BaseException as exc:
            capture_code = getattr(exc, "code", 74)
            capture_error = short_error(exc)
        finally:
            # Unknown poll/TERM/wait results never clear unsettled. Latch any
            # natural exit before sync/receipt work, and never replace it with
            # an exit caused by this controller's termination request.
            if proc is not None and not direct_reaped:
                try:
                    observed = proc.poll()
                    if observed is not None:
                        require(type(observed) is int, "nonconclusive poll")
                        native_exit = observed
                    else:
                        terminated = True
                        proc.terminate()
                    waited = proc.wait(timeout=5)
                    require(type(waited) is int, "nonconclusive settlement wait")
                    if terminated:
                        cleanup_exit = waited
                    else:
                        require(waited == native_exit, "poll/wait status mismatch")
                    direct_reaped = True
                    self.unsettled = False
                except BaseException as exc:
                    settlement_errors.append(short_error(exc))
                    self.unsettled = True
            # Each close/sync is independent; no exception escapes to overwrite
            # the captured primary. Keep these failures even after native exit0.
            for i, f in enumerate(files):
                try:
                    f.flush()
                    os.fsync(f.fileno())
                    sync_ok[i] = True
                except BaseException as exc:
                    final_errors.append("stream sync: " + short_error(exc))
                try:
                    f.close()
                except BaseException as exc:
                    final_errors.append("stream close: " + short_error(exc))
            for handle in ([selector] if selector is not None else []) + ([proc.stdout, proc.stderr] if proc is not None else []):
                try:
                    handle.close()
                except BaseException as exc:
                    final_errors.append("handle close: " + short_error(exc))
            self.e.release(start_slot)
        native_code = (native_exit if native_exit >= 0 else 128 - native_exit) if native_exit is not None else 0
        result = dict(nativeExit=native_exit, nativeCode=native_code,
                      captureCode=capture_code, captureError=capture_error,
                      terminationRequested=terminated, cleanupExit=cleanup_exit,
                      settlementErrors=settlement_errors, directReaped=direct_reaped,
                      unsettled=self.unsettled, finalizationErrors=final_errors,
                      eof=eof, bytes=counts, accountedPrefixSha256=[h.hexdigest() for h in hashes],
                      streamSync=sync_ok, descendants="not observed; no host/process-group absence claim")
        result["primaryCode"] = native_code or capture_code or (70 if self.unsettled or settlement_errors else 0) or (74 if final_errors else 0)
        try:
            require(result_slot is not None, "result reservation unavailable; child not launched")
            self.e.write(name + "-result.json", result, ticket=result_slot)
        except BaseException as exc:
            final_errors.append("result receipt: " + short_error(exc))
        code = native_code or capture_code or (70 if self.unsettled or settlement_errors else 0) or (74 if final_errors else 0)
        result["primaryCode"] = code
        if code:
            self.last_failure = result
            raise Stop("native/capture/settlement/finalization failure", code, result)
        return out

    def text(self, argv):
        return self.run(argv).read_text()


def check_route(ops, evidence, env, event):
    evidence.write("route-observed.json", dict(
        action=event.get("action"), number=event.get("number"), before=event.get("before"), after=event.get("after"),
        pullRequest={k: event.get("pull_request", {}).get(k) for k in ("number", "state", "draft", "head", "base")},
        contexts={k: env.get(k) for k in ("GITHUB_EVENT_NAME", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_REF",
                  "GITHUB_SHA", "GITHUB_ACTOR", "WORKFLOW_SHA", "WORKFLOW_REF", "RUNNER_ENVIRONMENT", "RUNNER_OS", "RUNNER_ARCH")}))
    git = lambda *a: ops.text([TOOLS["git"], *a]).strip()
    merge = git("rev-parse", "HEAD")
    parents = git("show", "-s", "--format=%P", "HEAD").split()
    tree = git("rev-parse", "HEAD^{tree}")
    head = event["pull_request"]["head"]["sha"]
    require(re.fullmatch("[0-9a-f]{40}", head), "invalid head")
    controller_parents = git("show", "-s", "--format=%P", head).split()
    require(controller_parents == [PRODUCT], "controller must be one child of the product source")
    changed = git("diff", "--name-only", PRODUCT, head).splitlines()
    require(set(changed) == {WORKFLOW, CONTROLLER} and len(changed) == 2, "controller publication scope")
    controller_tree = git("rev-parse", head + "^{tree}")
    require(git("status", "--porcelain", "--untracked-files=no") == "", "dirty source")
    source = {}
    for path in (WORKFLOW, CONTROLLER):
        m = git("rev-parse", merge + ":" + path)
        c = git("rev-parse", head + ":" + path)
        current = git("hash-object", path)
        source[path] = dict(merge=m, controller=c, current=current)
        require(m == c == current, "source bytes drift")
    result = route(event, env, merge, parents, tree, controller_tree, True, True)
    result["sources"] = source
    result["controllerParents"] = controller_parents
    result["changedPaths"] = changed
    result["tools"] = {k: dict(path=v, identity=identity(v)) for k, v in TOOLS.items()}
    result["host"] = dict(system=platform.system(), machine=platform.machine(),
                          macVersion=platform.mac_ver(), uid=os.getuid(), root=identity(evidence.root))
    require(platform.system() == "Darwin" and platform.machine() == "arm64", "Darwin arm64 required")
    evidence.write("route.json", result)


def acquire(ops, evidence, token):
    with ops.phase("metadata"):
        run = json.loads(ops.run([ops.gh, "api", f"repos/{REPO}/actions/runs/{BUILD}"], token=token).read_bytes())
        art = json.loads(ops.run([ops.gh, "api", f"repos/{REPO}/actions/artifacts/{ARTIFACT}"], token=token).read_bytes())
        require(run["id"] == BUILD and run["run_attempt"] == 1 and run["head_sha"] == PRODUCT
                and run["event"] == "workflow_dispatch" and run["conclusion"] == "success", "build metadata")
        require(art["id"] == ARTIFACT and art["workflow_run"]["id"] == BUILD
                and art["workflow_run"]["head_sha"] == PRODUCT and art["name"] == "manual-macos-dmg"
                and art["expired"] is False and art["size_in_bytes"] == ZIP_BYTES
                and art["digest"] == "sha256:" + ZIP_SHA, "artifact metadata")
    with ops.phase("zipTransfer"):
        archive = ops.run([ops.gh, "api", f"repos/{REPO}/actions/artifacts/{ARTIFACT}/zip",
                           "--allow-escape-sequences"], token=token, binary=True)
        verify_bytes(*digest_file(archive, ZIP_CAP, ops.tick), ZIP_BYTES, ZIP_SHA)
    return archive


def extract(ops, evidence, archive):
    # Bound EOCD count/directory before ZipFile allocates its index. Known archive
    # has one regular member and no ZIP64/multi-disk extensions.
    with ops.phase("centralDirectory"):
        import struct
        with archive.open("rb") as f:
            f.seek(-min(65557, archive.stat().st_size), 2)
            tail = f.read()
        at = tail.rfind(b"PK\x05\x06")
        require(at >= 0 and len(tail) >= at + 22, "EOCD absent")
        _, disk, start_disk, count, total, size, offset, comment = struct.unpack("<4s4H2LH", tail[at:at + 22])
        require(disk == start_disk == 0 and count == total and 0 < total <= 256
                and size <= 262144 and offset + size <= archive.stat().st_size - 22
                and at + 22 + comment == len(tail), "central directory limits")
        with zipfile.ZipFile(archive) as z:
            infos = z.infolist()
            require(len(infos) == total, "central count")
            evidence.write("members.json", member_inventory(infos))
    with ops.phase("selectedExtraction"):
        dmg = evidence.root / DMG_NAME
        with zipfile.ZipFile(archive) as z, z.open(DMG_NAME) as src, dmg.open("xb") as dst:
            size = 0
            h = hashlib.sha256()
            while chunk := src.read(1024 * 1024):
                ops.tick()
                size += len(chunk)
                require(size <= DMG_BYTES and ZIP_BYTES + size + evidence.bytes <= RETAINED_CAP, "retained cap")
                dst.write(chunk)
                h.update(chunk)
            dst.flush()
            os.fsync(dst.fileno())
        verify_bytes(size, h.hexdigest(), DMG_BYTES, DMG_SHA)
        evidence.write("payload.json", dict(name=DMG_NAME, bytes=size, sha256=h.hexdigest(), identity=identity(dmg)))
        return dmg


def inventory(ops, evidence, app):
    rows = []
    mach = []
    bundles = []
    total = 0
    metadata = 0
    for base, dirs, files in os.walk(app, followlinks=False):
        for name in sorted(dirs + files):
            ops.tick()
            p = pathlib.Path(base) / name
            s = p.lstat()
            row = dict(path=str(p.relative_to(app)), mode=s.st_mode, bytes=s.st_size)
            require(len(rows) < 100000, "inventory count")
            if stat.S_ISLNK(s.st_mode):
                target = p.resolve(strict=True)
                require(target.is_relative_to(app), "escaping bundle symlink")
                row["target"] = os.readlink(p)
            elif stat.S_ISREG(s.st_mode):
                total += s.st_size
                require(total <= 8589934592, "bundle logical bytes")
                row["sha256"] = digest_file(p, 8589934592, ops.tick)[1]
                with p.open("rb") as f:
                    if f.read(4) in MACH_MAGIC:
                        mach.append(p)
            else:
                require(stat.S_ISDIR(s.st_mode), "special file in bundle")
                if p.suffix in (".app", ".framework", ".xpc"):
                    bundles.append(p)
            metadata += len(json.dumps(row).encode()) + 2
            require(metadata <= 8388608, "inventory metadata cap")
            rows.append(row)
    require(len((json.dumps(rows, indent=2, ensure_ascii=True) + "\n").encode()) <= 8388608,
            "serialized inventory metadata cap")
    evidence.write("bundle-inventory.json", rows)
    require(mach, "no Mach-O members")
    return mach, bundles


def inspect(ops, evidence, dmg):
    mount = evidence.root / "mount"
    mount.mkdir(mode=0o700)
    original_dmg = identity(dmg)
    owned = None
    attach_attempted = False
    primary = 0
    primary_error = None
    primary_outcome = None
    cleanup = 0
    cleanup_error = None
    cleanup_outcome = None
    try:
        with ops.phase("dmgVerify"):
            ops.run([TOOLS["hdiutil"], "verify", str(dmg)])
        with ops.phase("attach"):
            require(shutil.disk_usage(evidence.root).free >= 4294967296, "free disk prerequisite")
            attach_attempted = True
            attach = plistlib.loads(ops.run([TOOLS["hdiutil"], "attach", "-readonly", "-nobrowse",
                       "-noautoopen", "-mountpoint", str(mount), "-plist", str(dmg)]).read_bytes())
            info = plistlib.loads(ops.run([TOOLS["hdiutil"], "info", "-plist"]).read_bytes())
            owned = mount_record(info, mount, dmg, attach["system-entities"])
            owned["mountIdentity"] = identity(mount)
            evidence.write("owned-mount.json", owned)
        with ops.phase("bundleInventory"):
            apps = list(mount.glob("*.app"))
            require(len(apps) == 1 and apps[0].name == "Intent.app" and not apps[0].is_symlink(), "unique app")
            app = apps[0].resolve()
            meta = json.loads(ops.text([TOOLS["plutil"], "-convert", "json", "-o", "-",
                                       str(app / "Contents/Info.plist")]))
            require(meta["CFBundleIdentifier"] == "app.cloudlands.intent"
                    and meta["CFBundleShortVersionString"].split("-", 1)[0] == "2.189.0"
                    and isinstance(meta["CFBundleVersion"], str) and meta["CFBundleVersion"], "bundle product metadata")
            # Exact payload digest establishes manual.111 provenance. Record the
            # actual native build field; do not guess its encoding from the name.
            evidence.write("bundle-metadata.json", meta)
            mach, bundles = inventory(ops, evidence, app)
            required = ["Contents/MacOS/Intent", "Contents/Resources/intentd/intentd",
                        "Contents/Resources/tailcat/tailcat", "Contents/Resources/speech-helper/intent-speech-helper",
                        "Contents/Resources/keychain-helper/intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper"]
            require(all(app / p in mach for p in required), "required native payload absent")
        with ops.phase("nativeSignatureAndArchitecture"):
            loads = []
            for p in mach:
                require("arm64" in ops.text([TOOLS["lipo"], "-archs", str(p)]).split(), "arm64 absent")
                output = ops.text([TOOLS["otool"], "-L", str(p)])
                dependencies = []
                for line in output.splitlines()[1:]:
                    dep = line.strip().split(" (compatibility version", 1)[0]
                    require(not dep.startswith("/") or dep.startswith(("/usr/lib/", "/System/Library/", str(app) + "/")),
                            "non-system external absolute load path")
                    dependencies.append(dict(path=dep, resolution="inventory only; dyld/ABI not executed"))
                loads.append(dict(path=str(p.relative_to(app)), dependencies=dependencies))
            evidence.write("load-paths.json", loads)
            for p in sorted(set(mach + bundles + [app])):
                ops.run([TOOLS["codesign"], "--verify", "--strict", "--verbose=4", str(p)])
                ops.run([TOOLS["codesign"], "--display", "--verbose=4", "--requirements", "-", str(p)])
                ops.run([TOOLS["codesign"], "--display", "--entitlements", ":-", str(p)])
            prefix = evidence.receipts / "signer-"
            ops.run([TOOLS["codesign"], "--display", "--extract-certificates", str(prefix), str(app)])
            cert = pathlib.Path(str(prefix) + "0")
            require(cert.is_file() and cert.stat().st_size <= 65536, "certificate bound")
            require(hashlib.sha1(cert.read_bytes()).hexdigest().upper() == CERT_SHA1, "signer fingerprint")
        with ops.phase("ticketAndAssessment"):
            ops.run([TOOLS["xcrun"], "stapler", "validate", str(app)])
            ops.run([TOOLS["spctl"], "--assess", "--type", "execute", "--verbose=4", str(app)])
    except BaseException as exc:
        primary = getattr(exc, "code", 1)
        primary_error = type(exc).__name__ + ": " + str(exc)
        primary_outcome = getattr(exc, "outcome", None)
    finally:
        if attach_attempted:
            try:
                require(owned is not None and not ops.unsettled, "unresolved attach/child; do not guess cleanup")
                with ops.phase("detach"):
                    require(identity(dmg) == original_dmg and identity(mount) == owned["mountIdentity"], "owned identity drift")
                    info = plistlib.loads(ops.run([TOOLS["hdiutil"], "info", "-plist"]).read_bytes())
                    current = mount_record(info, mount, dmg, owned["entities"])
                    require(current["device"] == owned["device"], "device drift")
                    ops.run([TOOLS["hdiutil"], "detach", owned["device"]])
                    after = plistlib.loads(ops.run([TOOLS["hdiutil"], "info", "-plist"]).read_bytes())
                    require(not any(i.get("image-path") == str(dmg) or any(
                        e.get("dev-entry") == owned["device"] or e.get("mount-point") == str(mount)
                        for e in i.get("system-entities", [])) for i in after.get("images", [])), "owned detach absence")
            except BaseException as exc:
                cleanup = getattr(exc, "code", 1)
                cleanup_error = type(exc).__name__ + ": " + str(exc)
                cleanup_outcome = getattr(exc, "outcome", None)
    return dict(primary=primary, primaryError=primary_error, cleanup=cleanup, cleanupError=cleanup_error,
                primaryNativeOutcome=primary_outcome, cleanupNativeOutcome=cleanup_outcome,
                result=settle(primary, cleanup), attachAttempted=attach_attempted,
                noAppOrDaemonExecution=True, settlementScope="recorded image and direct native children only")


def freeze_upload(evidence, result, finalization, tick):
    """Copy a bounded immutable partial snapshot, even if a manifest is missing.

    Native tools never receive this sibling directory. Copy failures are visible
    and cannot make inspection pass. A storage failure may still prevent upload;
    reserved logical space is not a promise that physical I/O succeeds.
    """
    upload = evidence.root / "upload"
    upload.mkdir(mode=0o700)
    errors = []
    total = 0
    manifest_bytes = 0
    copied = 0
    try:
        paths = []
        for p in evidence.receipts.iterdir():
            require(len(paths) < 100000, "upload entry bound")
            paths.append(p)
        with (upload / "upload-manifest.jsonl").open("xb") as index:
            for p in sorted(paths, key=lambda p: (p.name not in ("terminal.json", "finalization.json"), p.name)):
                tick()
                require(p.name not in ("upload-manifest.jsonl", "upload-state.json")
                        and not p.is_symlink() and p.is_file(), "upload source type")
                before = identity(p)
                require(before["uid"] == os.getuid() and total + before["size"] <= LOG_CAP, "upload source bound")
                h = hashlib.sha256()
                size = 0
                with p.open("rb") as source, (upload / p.name).open("xb") as target:
                    while chunk := source.read(65536):
                        tick()
                        require(total + len(chunk) <= LOG_CAP and size + len(chunk) <= before["size"], "growing upload source")
                        total += len(chunk)
                        require(target.write(chunk) == len(chunk), "short snapshot write")
                        h.update(chunk)
                        size += len(chunk)
                    target.flush()
                    os.fsync(target.fileno())
                require(size == before["size"] and identity(p) == before, "upload source changed")
                line = (json.dumps(dict(name=p.name, bytes=size, sha256=h.hexdigest())) + "\n").encode()
                require(manifest_bytes + len(line) <= 2 * 1024**2, "upload manifest bound")
                manifest_bytes += len(line)
                require(index.write(line) == len(line), "short upload manifest write")
                copied += 1
            index.flush()
            os.fsync(index.fileno())
    except BaseException as exc:
        errors.append((type(exc).__name__ + ": " + str(exc))[:1024])
        finalization = 74
    state = dict(primary=result["primary"], cleanup=result["cleanup"],
                 result=result["result"], finalization=finalization,
                 complete=not errors and finalization == 0,
                 errors=errors, copiedFiles=copied, copiedBytesUpperBound=total,
                 manifestBytes=manifest_bytes, sourceManifestPresent=(evidence.receipts / "manifest.json").is_file(),
                 qualification="partial evidence never establishes a passing inspection or settled ownership")
    data = (json.dumps(state, indent=2) + "\n").encode()
    require(len(data) <= 65536 and total + manifest_bytes + len(data) <= UPLOAD_CAP, "upload bound")
    require(ZIP_BYTES + DMG_BYTES + LOG_CAP + total + manifest_bytes + len(data) <= RETAINED_CAP,
            "combined retained bound including snapshot")
    with (upload / "upload-state.json").open("xb") as f:
        require(f.write(data) == len(data), "short upload state write")
        f.flush()
        os.fsync(f.fileno())
    return upload, finalization


def finalize_evidence(evidence, result, tick=lambda: None):
    finalization = 0
    error = None
    try:
        evidence.write("terminal.json", result, ticket=evidence.terminal_slot)
        rows = []
        total = 0
        for p in sorted(evidence.receipts.iterdir()):
            tick()
            require(p.is_file() and not p.is_symlink(), "receipt type")
            n, h = digest_file(p, LOG_CAP, tick)
            total += n
            require(total <= LOG_CAP, "actual receipt cap")
            rows.append(dict(name=p.name, bytes=n, sha256=h))
        evidence.write("manifest.json", rows, ticket=evidence.manifest_slot)
    except BaseException as exc:
        finalization = 74
        error = (type(exc).__name__ + ": " + str(exc))[:1024]
    try:
        evidence.write("finalization.json", dict(primary=result["primary"], cleanup=result["cleanup"],
                       finalization=finalization, error=error), ticket=evidence.final_slot)
    except BaseException:
        finalization = 74
    try:
        return freeze_upload(evidence, result, finalization, tick)
    except BaseException:
        # Snapshot/write failure is separate from the original primary.
        return None, 74


def main():
    os.umask(0o077)
    root = pathlib.Path(tempfile.mkdtemp(prefix="packaged-inspection-", dir=os.environ["RUNNER_TEMP"]))
    evidence = Evidence(root)
    token = os.environ.pop("GH_TOKEN", None)
    result = dict(primary=1, cleanup=0, result=1, primaryError="not started")
    try:
        ops = Native(evidence)
        with ops.phase("nativeReadiness"):
            event_path = pathlib.Path(os.environ["GITHUB_EVENT_PATH"])
            require(event_path.stat().st_size <= 2097152, "event input cap")
            event = json.loads(event_path.read_bytes())
            check_route(ops, evidence, os.environ, event)
        require(token, "private artifact read token absent")
        archive = acquire(ops, evidence, token)
        token = None
        dmg = extract(ops, evidence, archive)
        result = inspect(ops, evidence, dmg)
    except BaseException as exc:
        result["primary"] = result["result"] = getattr(exc, "code", 1)
        result["primaryError"] = type(exc).__name__ + ": " + str(exc)
        result["primaryNativeOutcome"] = getattr(exc, "outcome", None)
    finally:
        token = None
        finalization = 0
        upload = None
        try:
            with ops.phase("finalize") if "ops" in locals() else contextlib.nullcontext():
                upload, finalization = finalize_evidence(evidence, result, ops.tick if "ops" in locals() else lambda: None)
        except BaseException:
            finalization = 74
        # Partial bounded evidence is uploadable while the step still fails.
        # Output-write failure also cannot override a nonzero native primary.
        try:
            with open(os.environ["GITHUB_OUTPUT"], "a") as f:
                f.write(f"primary={result['primary']}\ncleanup={result['cleanup']}\nfinalization={finalization}\n")
                if upload is not None:
                    f.write(f"receipt_path={upload}\nupload_ready=true\n")
                else:
                    f.write("upload_ready=false\n")
        except BaseException:
            finalization = 74
    return settle(result["result"], finalization)


if __name__ == "__main__":
    sys.exit(main())
