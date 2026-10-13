import * as fs from 'node:fs';
import path from 'node:path';

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
    return () => disposers.forEach((dispose) => dispose());
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
  return { attach, capture };
}
