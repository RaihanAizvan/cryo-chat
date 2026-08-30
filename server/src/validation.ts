/**
 * Message validation and per-socket rate limiting.
 * Kept separate from the room/session managers for clarity.
 */

import { MAX_MESSAGE_LENGTH } from "@cryo/shared";

/** Normalize + validate a chat message. Returns null if invalid. */
export function normalizeMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (text.trim().length === 0) return null;
  if (text.length > MAX_MESSAGE_LENGTH) return null;
  // Reject control characters (but allow newline and tab).
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return null;
  return text;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Tiny fixed-window rate limiter keyed by socket id. */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Returns true if the key is allowed, false if it exceeds the limit.
   * The window slides forward on reset.
   */
  allow(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (bucket.count >= this.limit) {
      return false;
    }
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return true;
  }

  /** Drop expired buckets to bound memory. */
  sweep(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}
