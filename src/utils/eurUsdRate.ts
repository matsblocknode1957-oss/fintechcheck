const FALLBACK_RATE = 1.16;
const REFRESH_MS = 4 * 60 * 60 * 1000;  // 4 hours
// Fetch USDC priced in EUR (reliable USD proxy), then invert to get EUR/USD.
// e.g. { "usd-coin": { eur: 0.862 } } → 1 / 0.862 ≈ 1.160
// "ids=usd" does not map to a fiat currency on CoinGecko — it matches an
// obscure token priced at ~$0.001, producing nonsense values. usd-coin (USDC)
// is the correct stable proxy for this calculation.
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=eur';

let _rate = FALLBACK_RATE;
let _timer: NodeJS.Timeout | undefined;

export function getEurUsdRate(): number {
  return _rate;
}

async function fetchAndUpdate(): Promise<void> {
  try {
    const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { 'usd-coin'?: { eur?: number } };
    const usdInEur = data?.['usd-coin']?.eur;
    if (typeof usdInEur === 'number' && usdInEur > 0.5 && usdInEur < 1.5) {
      _rate = 1 / usdInEur;
      console.log(`[EurUsd] EUR/USD = ${_rate.toFixed(4)} (1 / ${usdInEur.toFixed(4)})`);
    } else {
      console.warn(`[EurUsd] Unexpected value ${usdInEur} — keeping ${_rate.toFixed(4)}`);
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
