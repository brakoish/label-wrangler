/**
 * Batched print queue for large runs.
 *
 * Each batch is a single ZPL document containing N ^XA..^XZ label definitions,
 * sent as one transfer to the printer. After each batch we report progress so
 * the UI can update and the run's printedCount can be persisted (for resume).
 */

export interface PrintBatchSender {
  /** Send a single ZPL string (may contain multiple labels) to the printer. */
  send: (zpl: string) => Promise<void>;
}

export interface RunQueueOptions {
  /** Ordered list of per-label ZPL strings. Each entry is one complete ^XA..^XZ. */
  labels: string[];
  /** How many labels to bundle into a single transfer. Default 25. */
  batchSize?: number;
  /** Optional breath between batches to let the printer catch up. Default 0. */
  delayBetweenBatchesMs?: number;
  /** Where to start printing from (inclusive, 0-based). Use for resume. Default 0. */
  startIndex?: number;
  /** Called after each successful batch with (printedCount, total). */
  onProgress?: (printedCount: number, total: number) => void;
  /** Called if a batch fails. Queue enters 'error' state; caller can retry. */
  onError?: (err: unknown, attemptedIndex: number) => void;
}

export type RunQueueStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

export interface RunQueueHandle {
  readonly status: RunQueueStatus;
  readonly printedCount: number;
  readonly total: number;
  pause: () => void;
  resume: () => Promise<void>;
  cancel: () => void;
}

/**
 * Start a batched print queue. Returns a handle that lets the caller pause,
 * resume, or cancel. Progress is reported to onProgress after each batch.
 */
export function startPrintQueue(
  sender: PrintBatchSender,
  options: RunQueueOptions,
): RunQueueHandle {
  const {
    labels,
    batchSize = 25,
    delayBetweenBatchesMs = 0,
    startIndex = 0,
    onProgress,
    onError,
  } = options;

  let status: RunQueueStatus = 'idle';
  let printedCount = startIndex;
  const total = labels.length;
  let pauseResolve: (() => void) | null = null;

  const waitWhilePaused = () =>
    new Promise<void>((resolve) => {
      pauseResolve = resolve;
    });

  const sleep = (ms: number) =>
    new Promise<void>((r) => setTimeout(r, ms));

  const run = async () => {
    status = 'running';
    try {
      while (printedCount < total) {
        if ((status as RunQueueStatus) === 'cancelled') return;
        if ((status as RunQueueStatus) === 'paused') {
          await waitWhilePaused();
          if ((status as RunQueueStatus) === 'cancelled') return;
        }

        const end = Math.min(printedCount + batchSize, total);
        const batch = labels.slice(printedCount, end);
        const payload = batch.join('\n');

        try {
          await sender.send(payload);
        } catch (err) {
          status = 'error';
          onError?.(err, printedCount);
          return;
        }

        printedCount = end;
        onProgress?.(printedCount, total);

        if (printedCount < total && delayBetweenBatchesMs > 0) {
          await sleep(delayBetweenBatchesMs);
        }
      }
      status = 'completed';
    } catch (err) {
      status = 'error';
      onError?.(err, printedCount);
    }
  };

  // Kick off immediately.
  void run();

  return {
    get status() {
      return status;
    },
    get printedCount() {
      return printedCount;
    },
    get total() {
      return total;
    },
    pause: () => {
      if (status === 'running') status = 'paused';
    },
    resume: async () => {
      if (status !== 'paused') return;
      status = 'running';
      if (pauseResolve) {
        const r = pauseResolve;
        pauseResolve = null;
        r();
      }
    },
    cancel: () => {
      status = 'cancelled';
      if (pauseResolve) {
        const r = pauseResolve;
        pauseResolve = null;
        r();
      }
    },
  };
}
