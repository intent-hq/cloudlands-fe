import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import { z } from 'zod';
import type { DesktopCredential, DesktopStopReports } from './desktop-executor';
import { desktopFailure } from './desktop-validation';

const recordSchema = z
  .object({
    backendId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    principalId: z.string(),
    sessionId: z.string(),
    computerId: z.string(),
    connectionEpoch: z.string(),
    stopReportToken: z.string(),
    reportId: z.string().optional(),
    acknowledged: z.boolean().optional(),
  })
  .strict();
type Record = z.infer<typeof recordSchema>;
type SendReport = (params: {
  workspaceId: string;
  sessionId: string;
  reason: 'user_stop';
  stopReport: {
    reportId: string;
    computerId: string;
    connectionEpoch: string;
    stopReportToken: string;
  };
}) => Promise<unknown>;

/** Protected app-local outbox, never workspace content. Failed writes keep the
 * in-memory report and fail visibly; they cannot restore native authority. */
export class DesktopReportStore implements DesktopStopReports {
  private records: Record[] = [];
  private loading?: Promise<void>;
  private writes = Promise.resolve();
  private senders = new Map<string, { principalId: string; send: SendReport }>();
  private flushing = new Set<string>();
  private retry?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly directory = () => join(app.getPath('userData'), 'desktop-stop-reports'),
    private readonly notifyFailure: () => void = () => {},
  ) {}
  private async load(): Promise<void> {
    if (!this.loading)
      this.loading = (async () => {
        if (!safeStorage.isEncryptionAvailable())
          throw desktopFailure(
            'desktop-execution-failed',
            'Protected local credential storage is unavailable',
          );
        try {
          const files = (await fs.readdir(this.directory())).filter((name) =>
            /^[a-f0-9]{64}\.enc$/.test(name),
          );
          this.records = await Promise.all(
            files.map(async (name) =>
              recordSchema.parse(
                JSON.parse(
                  safeStorage.decryptString(await fs.readFile(join(this.directory(), name))),
                ),
              ),
            ),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.records = [];
          else
            throw desktopFailure(
              'desktop-execution-failed',
              'Protected desktop credentials could not be read',
            );
        }
      })();
    await this.loading;
  }
  private path(record: DesktopCredential): string {
    return join(
      this.directory(),
      createHash('sha256')
        .update(JSON.stringify([record.backendId, record.sessionId]))
        .digest('hex') + '.enc',
    );
  }
  private persist(record: Record): Promise<void> {
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        const filename = this.path(record);
        await fs.mkdir(dirname(filename), { recursive: true, mode: 0o700 });
        const data = safeStorage.encryptString(JSON.stringify(record));
        const temp = `${filename}.${randomUUID()}.tmp`;
        try {
          const file = await fs.open(temp, 'wx', 0o600);
          try {
            await file.writeFile(data);
            await file.sync();
          } finally {
            await file.close();
          }
          await fs.rename(temp, filename);
          if (process.platform !== 'win32') {
            const dir = await fs.open(dirname(filename), 'r');
            try {
              await dir.sync();
            } finally {
              await dir.close();
            }
          }
        } finally {
          await fs.unlink(temp).catch(() => {});
        }
      });
    this.writes = write;
    return write;
  }
  async retain(credential: DesktopCredential): Promise<void> {
    await this.load();
    let record = this.records.find(
      (r) => r.backendId === credential.backendId && r.sessionId === credential.sessionId,
    );
    if (!record) {
      record = { ...credential };
      this.records.push(record);
    }
    await this.persist(record);
  }
  async queue(credential: DesktopCredential): Promise<void> {
    await this.load();
    let record = this.records.find(
      (r) => r.backendId === credential.backendId && r.sessionId === credential.sessionId,
    );
    if (!record) {
      record = { ...credential };
      this.records.push(record);
    }
    record.reportId ??= randomUUID();
    if (record.acknowledged) return;
    try {
      await this.persist(record);
    } catch (error) {
      this.notifyFailure();
      void this.flush(credential.backendId);
      throw error;
    }
    void this.flush(credential.backendId);
  }
  connect(backendId: string, principalId: string, send: SendReport): void {
    this.senders.set(backendId, { principalId, send });
    void this.flush(backendId);
  }
  disconnect(backendId: string, send: SendReport): void {
    if (this.senders.get(backendId)?.send === send) this.senders.delete(backendId);
  }
  async flush(backendId: string): Promise<void> {
    if (this.flushing.has(backendId)) return;
    this.flushing.add(backendId);
    try {
      await this.load();
      for (const record of [...this.records]) {
        const sender = this.senders.get(backendId);
        if (
          !sender ||
          sender.principalId !== record.principalId ||
          record.backendId !== backendId ||
          !record.reportId ||
          record.acknowledged
        )
          continue;
        try {
          await sender.send({
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            reason: 'user_stop',
            stopReport: {
              reportId: record.reportId,
              computerId: record.computerId,
              connectionEpoch: record.connectionEpoch,
              stopReportToken: record.stopReportToken,
            },
          });
        } catch (error) {
          const code = (error as { data?: { code?: string } }).data?.code;
          if (code !== 'not-found') continue;
          await fs.unlink(this.path(record));
          this.records = this.records.filter((r) => r !== record);
          continue;
        }
        record.acknowledged = true;
        await this.persist(record);
      }
    } catch {
      this.notifyFailure();
    } finally {
      this.flushing.delete(backendId);
      if (
        !this.retry &&
        this.records?.some((r) => r.reportId && !r.acknowledged && this.senders.has(r.backendId))
      ) {
        this.retry = setTimeout(() => {
          this.retry = undefined;
          for (const id of this.senders.keys()) void this.flush(id);
        }, 30000);
        this.retry.unref?.();
      }
    }
  }
}
