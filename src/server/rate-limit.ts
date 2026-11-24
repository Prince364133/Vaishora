import "server-only";

// Fixed-window in-memory rate limiter. Adequate for a single server instance; for multiple
// instances (e.g. serverless), back this with Redis/Upstash — see docs/DEPLOYMENT.md.

const buckets = ((globalThis as unknown as { __rl?: Map<string, { n: number; reset: number }> }).__rl ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  if (process.env.NODE_ENV !== "production") return { ok: true, retryAfter: 0 };
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    return { ok: true, retryAfter: 0 };
  }
  b.n++;
  return { ok: b.n <= limit, retryAfter: Math.ceil((b.reset - now) / 1000) };
}

export function ipFrom(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}
