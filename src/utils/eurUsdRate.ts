const FALLBACK_RATE = 1.15;
const REFRESH_MS = 4 * 60 * 60 * 1000;  // 4 hours
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=euro&vs_currencies=usd';

let _rate = FALLBACK_RATE;
let _timer: NodeJS.Timeout | undefined;

export function getEurUsdRate(): number {
  return _rate;
}

async function fetchAndUpdate(): Promise<void> {
  try {
    const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { euro?: { usd?: number } };
    const rate = data?.euro?.usd;
    if (typeof rate === 'number' && rate > 1.0 && rate < 2.0) {
      _rate = rate;
      console.log(`[EurUsd] EUR/USD = ${_rate.toFixed(4)} (live)`);
    } else {
      console.warn(`[EurUsd] Unexpected value ${rate} — keeping ${_rate.toFixed(4)}`);
    }
  } catch (err) {
    console.warn(`[EurUsd] Fetch failed — keeping ${_rate.toFixed(4)}: ${(err as Error).message}`);
  }
}

export async function startEurUsdRefresh(): Promise<void> {
  await fetchAndUpdate();
  _timer = setInterval(() => { fetchAndUpdate().catch(() => {}); }, REFRESH_MS);
  console.log(`[EurUsd] Refreshing every 4h — EURC peg = ${_rate.toFixed(4)}`);
}

export function stopEurUsdRefresh(): void {
  if (_timer) { clearInterval(_timer); _timer = undefined; }
}
