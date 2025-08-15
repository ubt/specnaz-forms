// Very small cooperative rate limiter to avoid Notion 429s on Edge runtimes
let last = 0;
const MIN_GAP_MS = 350; // ~3 req/sec

export async function rateLimit() {
  const now = Date.now();
  const diff = now - last;
  if (diff < MIN_GAP_MS) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS - diff));
  }
  last = Date.now();
}
