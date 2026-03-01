// Echelon Analytics — Generic Buffered Writer
//
// Batches records in memory and flushes them periodically via a provided
// insert callback. Used by both the view and event writers.

import type { DbAdapter } from "./db/adapter.ts";

export class BufferedWriter<T> {
  private buffer: T[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly insert: (db: DbAdapter, batch: T[]) => Promise<void>,
    private readonly maxBuffer: number,
    private readonly flushMs: number,
    private readonly label: string,
  ) {}

  get size(): number {
    return this.buffer.length;
  }

  push(record: T): void {
    if (this.buffer.length < this.maxBuffer) {
      this.buffer.push(record);
    }
  }

  start(db: DbAdapter): void {
    if (this.timer) return;
    const jitter = Math.floor(Math.random() * 5_000);
    setTimeout(() => {
      this.flush(db);
      this.timer = setInterval(() => this.flush(db), this.flushMs);
    }, jitter);
    console.log(
      `[echelon] ${this.label} writer started (flush every ${
        this.flushMs / 1000
      }s)`,
    );
  }

  async stop(db: DbAdapter): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush(db);
  }

  private flush(db: DbAdapter): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.buffer.length === 0) return Promise.resolve();
    const batch = this.buffer.splice(0);
    this.flushing = this.insert(db, batch)
      .catch((e) => {
        console.error(`[echelon] ${this.label} flush failed:`, e);
        this.buffer.unshift(...batch);
        if (this.buffer.length > this.maxBuffer) {
          this.buffer.length = this.maxBuffer;
        }
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }
}
