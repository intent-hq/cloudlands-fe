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
PREVIOUS = "ea28a8e733c9b5699923b6e74b0142950af38d5b"
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
    require(pr["head"]["ref"] == BRANCH and event["before"] == PREVIOUS
            and event["after"] == head and head not in (PRODUCT, PREVIOUS), "one-use head transition")
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


def attachment_entities(rows, mount):
    """Strict identity for the two-device HFS shape observed in retained V75.

    Only order and explicitly observed optional presentation fields normalize.
    Unknown keys/shapes fail closed; this is not a general macOS schema parser.
    """
    require(isinstance(rows, list) and len(rows) == 2, "attachment entity count")
    allowed = {"dev-entry", "mount-point", "content-hint", "unmapped-content-hint",
               "potentially-mountable", "volume-kind"}
    devices = {}
    hfs = "48465300-0000-11AA-AA11-00306543ECAC"
    for row in rows:
        require(isinstance(row, dict) and set(row) <= allowed, "unknown attachment entity fields")
        device = row.get("dev-entry")
        require(isinstance(device, str) and re.fullmatch(r"/dev/disk[0-9]+(?:s[0-9]+)?", device)
                and device not in devices, "duplicate/invalid attachment device")
        devices[device] = row
    roots = [d for d in devices if re.fullmatch(r"/dev/disk[0-9]+", d)]
    require(len(roots) == 1, "attachment root device")
    root = roots[0]
    slices = [d for d in devices if d != root]
    require(len(slices) == 1 and re.fullmatch(re.escape(root) + r"s[0-9]+", slices[0]), "attachment slice family")
    stable = []
    for device in sorted(devices):
        row = devices[device]
        is_slice = device != root
        hint = hfs if is_slice else "GUID_partition_scheme"
        require(row.get("content-hint") in ({hfs, "Apple_HFS"} if is_slice else {hint}), "attachment filesystem hint")
        if "unmapped-content-hint" in row:
            require(row["unmapped-content-hint"] == hint, "conflicting unmapped hint")
        if "potentially-mountable" in row:
            require(row["potentially-mountable"] is is_slice, "conflicting mountability")
        if "volume-kind" in row:
            require(is_slice and row["volume-kind"] == "hfs", "conflicting volume kind")
        if is_slice:
            require(row.get("mount-point") == str(mount), "private mount identity")
        else:
            require("mount-point" not in row, "root device unexpectedly mounted")
        stable.append(dict(device=device, mount=str(mount) if is_slice else None, filesystem=hint))
    return dict(device=root, entities=stable)


def attach_record(attach, mount, dmg, verified_dmg, evidence_root):
    """Capture attributable attach identity before any follow-up comparison.

    Cleanup still requires fresh info proving this exact backing/device/mount,
    runtime owner and read-only state; a successful command alone is not enough.
    """
    require(isinstance(attach, dict) and set(attach) == {"system-entities"}, "attach response shape")
    require(dmg == evidence_root / DMG_NAME and not dmg.is_symlink()
            and dmg.is_file() and identity(dmg) == verified_dmg, "verified backing identity drift")
    require(verified_dmg["uid"] == os.getuid() and verified_dmg["mode"] == 0o600
            and verified_dmg["size"] == DMG_BYTES, "private backing owner/mode/size")
    require(mount == evidence_root / "mount" and not mount.is_symlink() and mount.is_dir(), "private mount path/type")
    stable = attachment_entities(attach["system-entities"], mount)
    return dict(backing=str(dmg), backingIdentity=verified_dmg,
                backingBytes=DMG_BYTES, backingSha256=DMG_SHA,
                entities=attach["system-entities"], stableEntities=stable["entities"], device=stable["device"],
                mount=str(mount), mountIdentity=identity(mount), runtimeOwner=os.getuid(),
                readonlyRequested=True, infoValidated=False)


def mount_record(info, mount, dmg, entities, owner=None):
    """Match an exact stable device set, never a guessed disk or PID."""
    owner = os.getuid() if owner is None else owner
    require(type(owner) is int and isinstance(info, dict) and isinstance(info.get("images"), list), "image inventory/owner")
    images = info["images"]
    require(all(isinstance(i, dict) for i in images), "image inventory shape")
    matches = [i for i in images if i.get("image-path") == str(dmg)]
    require(len(matches) == 1, "backing image ambiguity")
    image = matches[0]
    require(image.get("writeable") is False, "image not read-only")
    require(type(image.get("owner-uid")) is int and image["owner-uid"] == owner, "image runtime owner")
    expected = attachment_entities(entities, mount)
    actual = attachment_entities(image.get("system-entities"), mount)
    require(expected == actual, "attach/info stable identity differs")
    devices = {e["device"] for e in expected["entities"]}
    for other in images:
        if other is image:
            continue
        require(isinstance(other.get("system-entities", []), list), "foreign image inventory shape")
        for entity in other.get("system-entities", []):
            require(isinstance(entity, dict) and entity.get("dev-entry") not in devices
                    and entity.get("mount-point") != str(mount), "ambiguous image device/mount")
    pid = image.get("hdid-pid")
    require(type(pid) is int and pid > 0, "image provider PID absent")
    return dict(backing=str(dmg), entities=actual["entities"], device=actual["device"],
                readonly=True, runtimeOwner=owner, hdidPid=pid)


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
    require(controller_parents == [PREVIOUS], "controller must be one child of the consumed predecessor")
    # Immutable PREVIOUS already differs from PRODUCT only at these controls;
    # sole-parent ancestry plus this exact delta preserves every other path.
    changed = git("diff", "--name-only", PREVIOUS, head).splitlines()
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


CANVAS_PATH = "Contents/Resources/app.asar.unpacked/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node"
CANVAS_BYTES = 27971424
CANVAS_SHA = "7a7f2285fd6a5a8a89f3d1c6011537a727f4b9109bf637e30a62f052d53ae6f3"
DYLIB_LOADS = {"LC_LOAD_DYLIB", "LC_LOAD_WEAK_DYLIB", "LC_REEXPORT_DYLIB",
               "LC_LAZY_LOAD_DYLIB", "LC_LOAD_UPWARD_DYLIB"}
# These commands are retained as opaque diagnostic blocks, not runtime proof.
# Other path-bearing/obsolete/unknown commands fail closed in this narrow parser.
OPAQUE_COMMANDS = {"LC_SEGMENT_64", "LC_SYMTAB", "LC_DYSYMTAB", "LC_UUID",
                   "LC_CODE_SIGNATURE", "LC_SEGMENT_SPLIT_INFO", "LC_DYLD_INFO",
                   "LC_DYLD_INFO_ONLY", "LC_VERSION_MIN_MACOSX", "LC_FUNCTION_STARTS",
                   "LC_MAIN", "LC_DATA_IN_CODE", "LC_SOURCE_VERSION", "LC_DYLIB_CODE_SIGN_DRS",
                   "LC_ENCRYPTION_INFO_64", "LC_LINKER_OPTIMIZATION_HINT", "LC_NOTE",
                   "LC_BUILD_VERSION", "LC_DYLD_EXPORTS_TRIE", "LC_DYLD_CHAINED_FIXUPS"}


def typed_canvas_commands(text, full_path, legacy):
    """Conservative text-envelope classification; never waives the existing -L guard.

    Header counts and cmdsize sums reject incomplete command envelopes. Opaque
    bodies are not independently decoded Mach-O structures. Actual native output
    formatting remains to be demonstrated; unsupported forms stop, not normalize.
    """
    require(len(text.encode("utf-8")) <= 1048576 and text.endswith("\n")
            and all(ord(x) >= 32 or x in "\t\n" for x in text), "typed text bound/encoding")
    lines = text.splitlines()
    require(len(lines) >= 7 and lines[0] == full_path + ":"
            and lines[1] == "Mach header", "typed exact path/header")
    columns = lines[2].split()
    expected = ["magic", "cputype", "cpusubtype", "caps", "filetype", "ncmds", "sizeofcmds", "flags"]
    require(columns in (expected, expected + ["reserved"]), "typed header columns")
    values = lines[3].split()
    require(len(values) == len(columns)
            and all(re.fullmatch(r"(?:0x[0-9a-fA-F]+|[0-9]+)", v) for v in values), "typed numeric header")
    header = {k: int(v, 16 if v.startswith("0x") else 10) for k, v in zip(columns, values)}
    require(header["magic"] == 0xfeedfacf and header["cputype"] == 0x100000c
            and header["filetype"] in (6, 8), "typed arm64 dylib/bundle header")
    require(0 < header["ncmds"] <= 4096 and 0 < header["sizeofcmds"] <= CANVAS_BYTES,
            "typed command bounds")
    starts = [i for i in range(4, len(lines)) if re.fullmatch(r"Load command [0-9]+", lines[i])]
    require(len(starts) == header["ncmds"] and starts[0] == 4, "typed missing/extra commands")
    records = []
    size_sum = 0
    for number, start in enumerate(starts):
        end = starts[number + 1] if number + 1 < len(starts) else len(lines)
        body = [v.strip() for v in lines[start + 1:end]]
        require(lines[start] == f"Load command {number}" and len(body) >= 3,
                "typed command order/truncation")
        cmd = re.fullmatch(r"cmd (LC_[A-Z0-9_]+)", body[0])
        size = re.fullmatch(r"cmdsize ([0-9]+)", body[1])
        require(cmd is not None and size is not None
                and not any(re.match(r"(?:cmd|cmdsize)\b", v) for v in body[2:]), "typed command fields")
        kind = cmd.group(1)
        size = int(size.group(1))
        require(size >= 8 and size % 8 == 0, "typed command size")
        size_sum += size
        row = dict(index=number, command=kind, cmdsize=size, classification="opaque diagnostic only")
        if kind in DYLIB_LOADS | {"LC_ID_DYLIB", "LC_LOAD_DYLINKER", "LC_ID_DYLINKER", "LC_RPATH"}:
            dylib = kind in DYLIB_LOADS | {"LC_ID_DYLIB"}
            field = "path" if kind == "LC_RPATH" else "name"
            match = re.fullmatch(field + r" (.+) \(offset ([0-9]+)\)", body[2])
            require(match is not None, "typed path field")
            name, offset = match.group(1), int(match.group(2))
            require(offset == (24 if dylib else 12) and offset + len(name.encode()) + 1 <= size,
                    "typed string offset/size")
            require(len(body) == (6 if dylib else 3), "typed extra/missing path fields")
            if dylib:
                require(re.fullmatch(r"time stamp [0-9]+(?: .*)?", body[3])
                        and re.fullmatch(r"current version [0-9]+\.[0-9]+\.[0-9]+", body[4])
                        and re.fullmatch(r"compatibility version [0-9]+\.[0-9]+\.[0-9]+", body[5]),
                        "typed dylib fields")
            row.update(path=name, classification=("install ID" if kind in {"LC_ID_DYLIB", "LC_ID_DYLINKER"}
                       else "runpath" if kind == "LC_RPATH" else "dependency"))
        else:
            require(kind in OPAQUE_COMMANDS, "typed unknown/unsupported load command")
        records.append(row)
    require(size_sum == header["sizeofcmds"], "typed total command size")
    ids = [r for r in records if r["command"] == "LC_ID_DYLIB"]
    require(len(ids) <= 1 and (not ids or header["filetype"] == 6), "typed duplicate/inconsistent install ID")
    linkers = [r for r in records if r["command"] in {"LC_ID_DYLINKER", "LC_LOAD_DYLINKER"}]
    require(len(linkers) <= 1 and not any(r["command"] == "LC_ID_DYLINKER" for r in linkers),
            "typed duplicate/inconsistent dylinker")
    old_lines = legacy.splitlines()
    require(old_lines and old_lines[0] == full_path + ":" and legacy.endswith("\n"), "legacy exact path/header")
    names = []
    for line in old_lines[1:]:
        match = re.fullmatch(r"\s+(.+) \(compatibility version [0-9]+\.[0-9]+\.[0-9]+, current version [0-9]+\.[0-9]+\.[0-9]+\)", line)
        require(match is not None, "legacy malformed row")
        names.append(match.group(1))
    require(names == [r["path"] for r in records if r["command"] in DYLIB_LOADS | {"LC_ID_DYLIB"}],
            "typed/legacy names differ")
    return dict(header=header, commands=records, interpretation="diagnostic only; existing unsafe-load rejection remains",
                limitations="opaque command bodies not decoded; no dyld resolution, ABI or runtime compatibility proof")


def observe_canvas(ops, evidence, p, app, legacy):
    require(str(p.relative_to(app)) == CANVAS_PATH and p.is_file() and not p.is_symlink(), "typed exact canvas path")
    before = identity(p)
    verify_bytes(*digest_file(p, CANVAS_BYTES, ops.tick), CANVAS_BYTES, CANVAS_SHA)
    require(identity(p) == before, "typed canvas changed before command")
    argv = [TOOLS["otool"], "-m", "-h", "-l", str(p)]
    tool = identity(TOOLS["otool"])
    evidence.write("canvas-typed-intent.json", dict(argv=argv, toolIdentity=tool, fileIdentity=before,
                   product=PRODUCT, artifact=ARTIFACT, path=CANVAS_PATH, sha256=CANVAS_SHA))
    capture = ops.run(argv)
    require(identity(p) == before and identity(TOOLS["otool"]) == tool, "typed file/tool identity drift")
    verify_bytes(*digest_file(p, CANVAS_BYTES, ops.tick), CANVAS_BYTES, CANVAS_SHA)
    require(identity(p) == before, "typed canvas changed after command")
    require(capture.with_suffix(".stderr").stat().st_size == 0, "typed native diagnostic on stderr")
    require(capture.stat().st_size <= 1048576, "typed capture parse cap")
    parsed = typed_canvas_commands(capture.read_text(encoding="utf-8", errors="strict"), str(p), legacy)
    evidence.write("canvas-typed-commands.json", dict(parsed, capture=capture.name,
                   rawSha256=sha(capture.read_bytes()), argv=argv, toolIdentity=tool,
                   fileIdentity=before, fileSha256=CANVAS_SHA))
    # Diagnose every supported path-bearing load command, including those -L
    # omits. An ID is recorded separately, never used to bypass the old guard.
    for row in parsed["commands"]:
        if row["classification"] in ("dependency", "runpath"):
            dep = row["path"]
            require(not dep.startswith("/") or dep.startswith(("/usr/lib/", "/System/Library/", str(app) + "/")),
                    "typed non-system external absolute load path")



def inspect(ops, evidence, dmg):
    mount = evidence.root / "mount"
    mount.mkdir(mode=0o700)
    original_dmg = identity(dmg)
    owned = None
    detached_observed = False
    attach_attempted = False
    primary = 0
    primary_error = None
    primary_outcome = None
    cleanup = 0
    cleanup_error = None
    cleanup_outcome = None
    try:
        ownership_slot = evidence.reserve(RESULT_SLOT, "cleanup")
        with ops.phase("dmgVerify"):
            require(dmg == evidence.root / DMG_NAME and dmg.is_file() and not dmg.is_symlink(), "fixed private payload path")
            require(original_dmg["uid"] == os.getuid() and original_dmg["mode"] == 0o600
                    and original_dmg["size"] == DMG_BYTES, "private backing owner/mode/size")
            verify_bytes(*digest_file(dmg, DMG_BYTES, ops.tick), DMG_BYTES, DMG_SHA)
            require(identity(dmg) == original_dmg, "backing changed while rehashing")
            ops.run([TOOLS["hdiutil"], "verify", str(dmg)])
        with ops.phase("attach"):
            require(shutil.disk_usage(evidence.root).free >= 4294967296, "free disk prerequisite")
            attach_attempted = True
            attach = plistlib.loads(ops.run([TOOLS["hdiutil"], "attach", "-readonly", "-nobrowse",
                       "-noautoopen", "-mountpoint", str(mount), "-plist", str(dmg)]).read_bytes())
            owned = attach_record(attach, mount, dmg, original_dmg, evidence.root)
            evidence.write("attach-ownership.json", owned, ticket=ownership_slot)
            info = plistlib.loads(ops.run([TOOLS["hdiutil"], "info", "-plist"]).read_bytes())
            validation = mount_record(info, mount, dmg, owned["entities"], owned["runtimeOwner"])
            owned["infoValidated"] = True
            owned["hdidPid"] = validation["hdidPid"]
            evidence.write("owned-mount.json", dict(ownership=owned, validation=validation))
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
            require(sum(p == app / CANVAS_PATH for p in mach) == 1, "unique typed canvas target")
            loads = []
            for p in mach:
                require("arm64" in ops.text([TOOLS["lipo"], "-archs", str(p)]).split(), "arm64 absent")
                output = ops.text([TOOLS["otool"], "-m", "-L", str(p)])
                if str(p.relative_to(app)) == CANVAS_PATH:
                    observe_canvas(ops, evidence, p, app, output)
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
                    current = mount_record(info, mount, dmg, owned["entities"], owned["runtimeOwner"])
                    require(current["device"] == owned["device"] and current["entities"] == owned["stableEntities"], "device drift")
                    require(not owned["infoValidated"] or current["hdidPid"] == owned["hdidPid"], "image provider PID drift")
                    ops.run([TOOLS["hdiutil"], "detach", owned["device"]])
                    after = plistlib.loads(ops.run([TOOLS["hdiutil"], "info", "-plist"]).read_bytes())
                    require(isinstance(after, dict) and isinstance(after.get("images"), list), "detach inventory absent")
                    device_set = {e["device"] for e in owned["stableEntities"]}
                    require(not any(i.get("image-path") == str(dmg) or any(
                        e.get("dev-entry") in device_set or e.get("mount-point") == str(mount)
                        for e in i.get("system-entities", [])) for i in after["images"]), "owned detach absence")
                    detached_observed = True
            except BaseException as exc:
                cleanup = getattr(exc, "code", 1)
                cleanup_error = type(exc).__name__ + ": " + str(exc)
                cleanup_outcome = getattr(exc, "outcome", None)
    return dict(primary=primary, primaryError=primary_error, cleanup=cleanup, cleanupError=cleanup_error,
                primaryNativeOutcome=primary_outcome, cleanupNativeOutcome=cleanup_outcome,
                result=settle(primary, cleanup), attachAttempted=attach_attempted,
                attachmentOwnership=owned, detachedObserved=detached_observed,
                attachmentUnresolved=attach_attempted and not detached_observed,
                nativeWaitUnresolved=ops.unsettled,
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
