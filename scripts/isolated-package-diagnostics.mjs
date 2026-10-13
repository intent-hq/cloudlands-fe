import * as fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LIMIT = 64 * 1024;
const LINE_LIMIT = 8192;
// Drop whole sensitive lines, including serialized payloads; never copy profiles or environments.
export function redactDiagnosticLine(line) {
  if (/token|secret|password|authorization|credential|cookie|private.?key|BEGIN .*KEY/i.test(line))
    return '[sensitive diagnostic line omitted]';
  return line.replace(/\/Users\/[^/\s]+/g, '/Users/<private>');
}

export function createPackageDiagnostics(output, privateRoot) {
  let text = '';
  let ownedChild;
  const append = (line) => {
    text += redactDiagnosticLine(line) + '\n';
    while (Buffer.byteLength(text) > LIMIT) text = text.slice(text.indexOf('\n') + 1);
    try {
      fs.writeFileSync(path.join(output, 'startup-diagnostics.log'), text, { mode: 0o600 });
    } catch {
      // Diagnostic I/O must never prevent the original acceptance checks or cleanup.
      console.warn('Could not persist bounded package diagnostics');
    }
  };
  const attach = (child) => {
    ownedChild = child;
    const disposers = [];
    for (const [name, stream] of [
      ['stdout', child.stdout],
      ['stderr', child.stderr],
    ]) {
      if (!stream) continue;
      let pending = '';
      let dropping = false;
      const onData = (chunk) => {
        for (const part of chunk.toString('utf8').split(/(?<=\n)/)) {
          if (!dropping) pending += part;
          if (pending.length > LINE_LIMIT) {
            pending = '';
            dropping = true;
          }
          if (part.endsWith('\n')) {
            append(`${name}: ${dropping ? '[oversize line omitted]' : pending.trimEnd()}`);
            pending = '';
            dropping = false;
          }
        }
      };
      stream.on('data', onData);
      disposers.push(() => stream.off('data', onData));
    }
    return () => {
      disposers.forEach((dispose) => dispose());
      if (ownedChild === child) ownedChild = undefined;
    };
  };
  const captureStacks = () => {
    // Sample only the child returned by this verifier's Electron launch. This
    // host-side observation works even when main cannot answer inspector calls.
    const child = ownedChild;
    if (
      !child ||
      !Number.isSafeInteger(child.pid) ||
      child.pid <= 0 ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return;
    try {
      const sample = execFileSync('/usr/bin/sample', [String(child.pid), '1', '10'], {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // Omit process headers, invocation arguments, binary-image paths and all
      // non-stack sections. Apply the same whole-line redaction and byte cap.
      const graph = sample.split('Call graph:\n')[1]?.split('Total number in stack:')[0];
      let frames = '';
      for (const line of (graph ?? '').split('\n')) {
        if (!/^\s*(?:[+!:|]\s*)*\d+\s+\S/.test(line)) continue;
        const frame =
          redactDiagnosticLine(line.length > LINE_LIMIT ? '[oversize frame omitted]' : line) + '\n';
        if (Buffer.byteLength(frames) + Buffer.byteLength(frame) > LIMIT) break;
        frames += frame;
      }
      // Preserve the initial/main-thread frames separately from rolling logs.
      fs.writeFileSync(path.join(output, 'startup-stacks.log'), frames, { mode: 0o600 });
    } catch {
      // Never serialize an exec error: it can contain unfiltered child output.
      append('Stack sample unavailable');
    }
  };
  const capture = () => {
    // Read only the dedicated console log, never config, databases, secrets, or normal state.
    const file = path.join(privateRoot, 'desktop', 'logs', 'console-output.log');
    let fd;
    try {
      for (const directory of [
        privateRoot,
        path.join(privateRoot, 'desktop'),
        path.dirname(file),
      ]) {
        if (fs.realpathSync(directory) !== directory || !fs.lstatSync(directory).isDirectory())
          throw new Error('Noncanonical private diagnostic directory');
      }
      fd = fs.openSync(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid())
        throw new Error('Unsafe private diagnostic file');
      const buffer = Buffer.alloc(Math.min(stat.size, LIMIT));
      const offset = Math.max(0, stat.size - buffer.length);
      const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
      let lines = buffer.subarray(0, count).toString('utf8').split('\n');
      if (offset > 0) lines.shift(); // A partial first line could hide a sensitive prefix.
      lines.pop(); // Likewise never publish an incomplete final line.
      append('--- private console log ---');
      for (const line of lines) append(line.length > LINE_LIMIT ? '[oversize line omitted]' : line);
    } catch (error) {
      append(`Private log unavailable: ${error.code ?? error.message}`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };
  return { attach, capture, captureStacks };
}
