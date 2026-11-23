// Shared HTTP helper: browser-like UA, timeout, in-memory TTL cache, proxy support.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TTL_MS = Number(process.env.CACHE_TTL_SECONDS || 600) * 1000;
const cache = new Map();

export async function fetchText(url, { ttlMs = TTL_MS, timeoutMs = 15000 } = {}) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  const promise = (async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json,text/xml,*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.text();
  })();
  cache.set(url, { value: promise, expires: Date.now() + ttlMs });
  promise.catch(() => cache.delete(url));
  return promise;
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

/** Run async fn over items with bounded concurrency; failures become null. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx], idx);
        } catch {
          out[idx] = null;
        }
      }
    }),
  );
  return out;
}
