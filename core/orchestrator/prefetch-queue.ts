import type { OrchestratorEventHandler } from './types';

export const PREFETCH_PRIORITY = {
  VISIBLE: 0,
  NEXT: 1,
  NEXT_NEXT: 2,
  BACKGROUND: 3,
} as const;

export type QueueTaskSource = 'user' | 'prefetch';

export interface QueueItem {
  imageId: string;
  priority: number;
  source: QueueTaskSource;
  queuedAt: number;
  handler?: OrchestratorEventHandler;
}

/**
 * Priority queue for orchestrating translation tasks.
 *
 * Guarantees:
 * 1. User-triggered visible translation outranks background prefetch work.
 * 2. Look-ahead priorities (Visible = 0, Next = 1, Next-Next = 2) are strictly maintained.
 * 3. An image cannot exist multiple times in the queue (deduplication with priority upgrade).
 * 4. Background prefetch tasks can be cleanly purged when prefetch is disabled.
 */
export class PrefetchQueue {
  private items = new Map<string, QueueItem>();

  public enqueue(item: Omit<QueueItem, 'queuedAt'>): void {
    const existing = this.items.get(item.imageId);
    if (existing) {
      // Upgrade priority or source if incoming item has higher precedence
      const isUpgradingSource = item.source === 'user' && existing.source === 'prefetch';
      const isUpgradingPriority = item.priority < existing.priority;

      if (isUpgradingSource || (item.source === existing.source && isUpgradingPriority)) {
        this.items.set(item.imageId, {
          ...existing,
          priority: Math.min(existing.priority, item.priority),
          source: item.source === 'user' ? 'user' : existing.source,
          handler: item.handler ?? existing.handler,
        });
      } else if (item.handler && !existing.handler) {
        existing.handler = item.handler;
      }
      return;
    }

    this.items.set(item.imageId, {
      ...item,
      queuedAt: Date.now(),
    });
  }

  public dequeue(): QueueItem | undefined {
    const sorted = this.getSortedItems();
    if (sorted.length === 0) return undefined;

    const next = sorted[0];
    this.items.delete(next.imageId);
    return next;
  }

  public peek(): QueueItem | undefined {
    const sorted = this.getSortedItems();
    return sorted[0];
  }

  public has(imageId: string): boolean {
    return this.items.has(imageId);
  }

  public get(imageId: string): QueueItem | undefined {
    return this.items.get(imageId);
  }

  public remove(imageId: string): boolean {
    return this.items.delete(imageId);
  }

  public removePrefetchTasks(): number {
    let count = 0;
    for (const [imageId, item] of this.items.entries()) {
      if (item.source === 'prefetch') {
        this.items.delete(imageId);
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    this.items.clear();
  }

  public get size(): number {
    return this.items.size;
  }

  public getQueuedImageIds(): string[] {
    return this.getSortedItems().map((item) => item.imageId);
  }

  public getSortedItems(): QueueItem[] {
    const list = Array.from(this.items.values());
    return list.sort((a, b) => {
      // 1. User-triggered always outranks background prefetch work
      if (a.source === 'user' && b.source === 'prefetch') return -1;
      if (a.source === 'prefetch' && b.source === 'user') return 1;

      // 2. Lower priority number outranks higher priority number (0 > 1 > 2)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      // 3. FIFO if same source and priority
      return a.queuedAt - b.queuedAt;
    });
  }
}
