'use strict';

// Small symbol/name -> CoinGecko id map for the coins users mention most often.
// CoinGecko's /search endpoint is used as a fallback for anything not listed here.
const COIN_MAP = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum', ether: 'ethereum',
  sol: 'solana', solana: 'solana',
  bnb: 'binancecoin', binancecoin: 'binancecoin',
  xrp: 'ripple', ripple: 'ripple',
  ada: 'cardano', cardano: 'cardano',
  doge: 'dogecoin', dogecoin: 'dogecoin',
  ton: 'the-open-network', toncoin: 'the-open-network',
  trx: 'tron', tron: 'tron',
  avax: 'avalanche-2', avalanche: 'avalanche-2',
  dot: 'polkadot', polkadot: 'polkadot',
  link: 'chainlink', chainlink: 'chainlink',
  matic: 'matic-network', polygon: 'matic-network',
  shib: 'shiba-inu', 'shiba inu': 'shiba-inu',
  ltc: 'litecoin', litecoin: 'litecoin',
  uni: 'uniswap', uniswap: 'uniswap',
  atom: 'cosmos', cosmos: 'cosmos',
  xlm: 'stellar', stellar: 'stellar',
  near: 'near', 'near protocol': 'near',
  apt: 'aptos', aptos: 'aptos',
  arb: 'arbitrum', arbitrum: 'arbitrum',
  op: 'optimism', optimism: 'optimism',
  fil: 'filecoin', filecoin: 'filecoin',
  etc: 'ethereum-classic', 'ethereum classic': 'ethereum-classic',
  icp: 'internet-computer', 'internet computer': 'internet-computer',
  pepe: 'pepe',
  sui: 'sui',
  inj: 'injective-protocol', injective: 'injective-protocol',
};

const SYMBOL_BY_ID = Object.entries(COIN_MAP).reduce((acc, [key, id]) => {
  if (key.length <= 5 && !acc[id]) acc[id] = key.toUpperCase();
  return acc;
}, {});

/**
 * Scan free-text for coin mentions (symbols or names) and return a de-duplicated
 * list of CoinGecko ids to fetch data for. Caps at 3 coins per message to keep
 * prompt size and API usage sane.
 */
function detectCoinMentions(text) {
  if (!text) return [];
  const lower = ' ' + text.toLowerCase() + ' ';
  const found = new Set();
  for (const [key, id] of Object.entries(COIN_MAP)) {
    const pattern = new RegExp(`[^a-z0-9]${key.replace(/\s/g, '\\s')}[^a-z0-9]`, 'i');
    if (pattern.test(lower)) found.add(id);
    if (found.size >= 3) break;
  }
  return [...found];
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Request to ${url} failed with ${res.status}`);
  return res.json();
}

/**
 * Pull background + market stats for a CoinGecko coin id: price, 24h change,
 * market cap, rank, all-time high/low, and genesis/launch date when available.
 */
async function getCoinGeckoData(coinId) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const data = await fetchJson(url);
  const md = data.market_data || {};
  return {
    id: coinId,
    symbol: (data.symbol || '').toUpperCase(),
    name: data.name,
    genesisDate: data.genesis_date || null,
    homepage: (data.links && data.links.homepage && data.links.homepage[0]) || null,
    priceUsd: md.current_price && md.current_price.usd,
    change24h: md.price_change_percentage_24h,
    change7d: md.price_change_percentage_7d,
    change30d: md.price_change_percentage_30d,
    marketCapUsd: md.market_cap && md.market_cap.usd,
    marketCapRank: data.market_cap_rank,
    athUsd: md.ath && md.ath.usd,
    athDate: md.ath_date && md.ath_date.usd,
    atlUsd: md.atl && md.atl.usd,
    atlDate: md.atl_date && md.atl_date.usd,
    circulatingSupply: md.circulating_supply,
    totalSupply: md.total_supply,
  };
}

/**
 * Real-time spot price + 24h stats straight from Binance for the freshest possible
 * snapshot (used alongside CoinGecko's richer historical/background data).
 */
async function getBinance24hr(symbol) {
  const pair = `${symbol.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`;
  const data = await fetchJson(url);
  return {
    symbol: symbol.toUpperCase(),
    pair,
    lastPrice: parseFloat(data.lastPrice),
    priceChangePercent: parseFloat(data.priceChangePercent),
    highPrice: parseFloat(data.highPrice),
    lowPrice: parseFloat(data.lowPrice),
    quoteVolume: parseFloat(data.quoteVolume),
  };
}

/**
 * Build a compact "MARKET DATA" context block for one or more coins mentioned
 * in the user's message. Failures for individual coins/sources are swallowed
 * so one bad lookup doesn't break the whole chat turn.
 */
async function buildMarketContext(text) {
  const coinIds = detectCoinMentions(text);
  if (!coinIds.length) return '';

  const blocks = await Promise.all(
    coinIds.map(async (id) => {
      const symbol = SYMBOL_BY_ID[id] || id.toUpperCase();
      const [gecko, binance] = await Promise.allSettled([
        getCoinGeckoData(id),
        getBinance24hr(symbol),
      ]);

      const g = gecko.status === 'fulfilled' ? gecko.value : null;
      const b = binance.status === 'fulfilled' ? binance.value : null;
      if (!g && !b) return null;

      const lines = [];
      lines.push(`Coin: ${g ? g.name : symbol} (${symbol})`);
      if (b) {
        lines.push(`Live price (Binance, ${b.pair}): $${b.lastPrice}`);
        lines.push(`24h change: ${b.priceChangePercent}%  |  24h high: $${b.highPrice}  |  24h low: $${b.lowPrice}`);
        lines.push(`24h quote volume: $${Math.round(b.quoteVolume).toLocaleString('en-US')}`);
      } else if (g && g.priceUsd != null) {
        lines.push(`Price (CoinGecko): $${g.priceUsd}  |  24h change: ${g.change24h}%`);
      }
      if (g) {
        if (g.marketCapUsd) lines.push(`Market cap: $${Math.round(g.marketCapUsd).toLocaleString('en-US')}  (rank #${g.marketCapRank ?? 'N/A'})`);
        if (g.athUsd) lines.push(`All-time high: $${g.athUsd} on ${new Date(g.athDate).toISOString().slice(0, 10)}`);
        if (g.atlUsd) lines.push(`All-time low: $${g.atlUsd} on ${new Date(g.atlDate).toISOString().slice(0, 10)}`);
        if (g.genesisDate) lines.push(`Launch date: ${g.genesisDate}`);
        if (g.change7d != null) lines.push(`7d change: ${g.change7d.toFixed(2)}%  |  30d change: ${g.change30d != null ? g.change30d.toFixed(2) + '%' : 'N/A'}`);
      }
      return lines.join('\n');
    })
  );

  const valid = blocks.filter(Boolean);
  if (!valid.length) return '';
  return 'MARKET DATA (live, use as ground truth for current figures):\n' + valid.join('\n\n');
}

module.exports = { detectCoinMentions, getCoinGeckoData, getBinance24hr, buildMarketContext };
