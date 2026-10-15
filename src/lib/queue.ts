import { submitTransactionLog, TransactionPayload, CorruptedPayloadError } from './api';

const QUEUE_KEY = 'offline_tx_queue';
const QUARANTINE_KEY = 'quarantine_queue';

export class OfflineSyncDispatcher {
  private isProcessing = false;

  public async enqueue(record: TransactionPayload): Promise<void> {
    const queue = this.getQueue();
    queue.push(record);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  public getQueue(): TransactionPayload[] {
    const data = localStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  }

  public getQuarantineQueue(): TransactionPayload[] {
    const data = localStorage.getItem(QUARANTINE_KEY);
    return data ? JSON.parse(data) : [];
  }

  private quarantine(record: TransactionPayload): void {
    const quarantineList = this.getQuarantineQueue();
    quarantineList.push(record);
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify(quarantineList));
  }

  public async processQueue(): Promise<{ processed: number; quarantined: number; failed: number }> {
    if (this.isProcessing) return { processed: 0, quarantined: 0, failed: 0 };
    this.isProcessing = true;

    const queue = this.getQueue();
    if (queue.length === 0) {
      this.isProcessing = false;
      return { processed: 0, quarantined: 0, failed: 0 };
    }

    const remainingQueue: TransactionPayload[] = [];
    let processed = 0;
    let quarantined = 0;
    let failed = 0;

    for (const record of queue) {
      try {
        await submitTransactionLog(record);
        processed++;
      } catch (error) {
        if (error instanceof CorruptedPayloadError) {
          this.quarantine(record);
          quarantined++;
        } else {
          remainingQueue.push(record);
          failed++;
        }
      }
    }

    localStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    this.isProcessing = false;
    return { processed, quarantined, failed };
  }
}

export const syncDispatcher = new OfflineSyncDispatcher();