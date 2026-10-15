import {
  submitTransactionLog,
  TransactionPayload,
  CorruptedPayloadError,
  DuplicateTransactionError,
} from './api';

const QUEUE_KEY = 'offline_tx_queue';
const QUARANTINE_KEY = 'quarantine_queue';
const PROCESSED_KEY = 'processed_tx_ids';

export class OfflineSyncDispatcher {
  private isProcessing = false;

  /**
   * Idempotency Check: Checks if a transaction has already been processed.
   */
  public isProcessed(transactionId: string): boolean {
    const processed = this.getProcessedList();
    return processed.includes(transactionId);
  }

  public getProcessedList(): string[] {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(PROCESSED_KEY);
    return data ? JSON.parse(data) : [];
  }

  public markProcessed(transactionId: string): void {
    if (typeof window === 'undefined') return;
    const processed = this.getProcessedList();
    if (!processed.includes(transactionId)) {
      // Keep recent 200 entries to prevent localStorage bloat
      if (processed.length >= 200) processed.shift();
      processed.push(transactionId);
      localStorage.setItem(PROCESSED_KEY, JSON.stringify(processed));
    }
  }

  /**
   * Enqueues a transaction record.
   * Performs an idempotency check to detect and reject duplicate submissions.
   */
  public async enqueue(record: TransactionPayload): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    // Idempotency: Reject if already processed
    if (this.isProcessed(record.transaction_id)) {
      console.warn(
        `[Idempotency] Duplicate submission rejected: ${record.transaction_id} is already processed.`
      );
      return false;
    }

    // Idempotency: Reject if already present in active queue
    const queue = this.getQueue();
    if (queue.some((item) => item.transaction_id === record.transaction_id)) {
      console.warn(
        `[Idempotency] Duplicate submission rejected: ${record.transaction_id} is already in the queue.`
      );
      return false;
    }

    // Idempotency: Reject if already quarantined
    if (this.getQuarantineQueue().some((item) => item.transaction_id === record.transaction_id)) {
      console.warn(
        `[Idempotency] Duplicate submission rejected: ${record.transaction_id} is quarantined.`
      );
      return false;
    }

    queue.push(record);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return true;
  }

  public getQueue(): TransactionPayload[] {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  }

  public getQuarantineQueue(): TransactionPayload[] {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(QUARANTINE_KEY);
    return data ? JSON.parse(data) : [];
  }

  private quarantine(record: TransactionPayload): void {
    if (typeof window === 'undefined') return;
    const quarantineList = this.getQuarantineQueue();
    quarantineList.push(record);
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify(quarantineList));
  }

  public async processQueue(): Promise<{
    processed: number;
    quarantined: number;
    failed: number;
    duplicates: number;
  }> {
    if (this.isProcessing) {
      return { processed: 0, quarantined: 0, failed: 0, duplicates: 0 };
    }
    this.isProcessing = true;

    const queue = this.getQueue();
    if (queue.length === 0) {
      this.isProcessing = false;
      return { processed: 0, quarantined: 0, failed: 0, duplicates: 0 };
    }

    const remainingQueue: TransactionPayload[] = [];
    const seenInBatch = new Set<string>();
    let processed = 0;
    let quarantined = 0;
    let failed = 0;
    let duplicates = 0;

    for (const record of queue) {
      // In-batch idempotency check (reject duplicate entries queued during retries)
      if (seenInBatch.has(record.transaction_id) || this.isProcessed(record.transaction_id)) {
        console.warn(
          `[Idempotency] Dropping duplicate retry from queue: ${record.transaction_id}`
        );
        duplicates++;
        continue;
      }
      seenInBatch.add(record.transaction_id);

      try {
        await submitTransactionLog(record);
        this.markProcessed(record.transaction_id);
        processed++;
      } catch (error) {
        if (error instanceof DuplicateTransactionError) {
          // Idempotency: Server detected duplicate submission from retries -> drop from queue
          console.warn(
            `[Idempotency] Server rejected duplicate retry: ${record.transaction_id}. Removing from queue.`
          );
          this.markProcessed(record.transaction_id);
          duplicates++;
        } else if (error instanceof CorruptedPayloadError) {
          this.quarantine(record);
          quarantined++;
        } else {
          // Transient network failure: keep in queue for future retry
          remainingQueue.push(record);
          failed++;
        }
      }
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    }
    this.isProcessing = false;
    return { processed, quarantined, failed, duplicates };
  }
}

export const syncDispatcher = new OfflineSyncDispatcher();