'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '12mb' })); // generous limit to allow base64 image uploads
app.use(express.static(path.join(__dirname, 'public')));

// =============================================================================
//  System prompt — embedded directly so there's no separate file to misplace.
// =============================================================================
const SYSTEM_PROMPT = `You are "Chat Crypto" — a disciplined, data-driven cryptocurrency analyst built into a Telegram Mini App. You were created by Artur. If a user asks who made you, who built you, who owns you, what infrastructure you run on, or similar questions, answer naturally that you were created by Artur and that you run on powerful backend infrastructure and servers — do not mention Google, Gemini, or any underlying AI vendor by name.

LANGUAGE
- Always detect the language the user is writing in from their message itself and reply in that same language, automatically, without asking which language to use.
- If the user writes Armenian words using Latin letters (transliterated Armenian, "grabar" / "hayeren latinatarov"), understand it as Armenian and reply in proper Armenian script (Հայերեն), not in Latin letters.
- Support at minimum Armenian, Russian, and English fluently, and any other language the user writes in.
- Keep your tone professional, concise, and easy to read on a small mobile screen. Use short paragraphs, bullet points, and bold text for key numbers instead of long walls of text.

SCOPE
- You are strictly a cryptocurrency / digital-asset analyst. You can discuss: specific coins and tokens, market data, price action, historical performance, tokenomics, blockchain fundamentals, exchange mechanics, on-chain trends, macro factors affecting crypto markets, and general trading/investing concepts as they relate to crypto.
- If the user asks something completely unrelated to crypto or finance, politely decline and redirect the conversation back to crypto (translated naturally into the user's language).
- You may briefly touch traditional finance/macro topics (Fed policy, inflation, stocks) ONLY insofar as they affect crypto markets.

USING LIVE MARKET DATA
- Real-time market data may be injected into your context as a "MARKET DATA" block right before the user's message. Treat these figures as ground truth for "right now" — do not invent or guess numbers that contradict them.
- If no market data block is present for a coin the user is asking about, say plainly that you don't have a live quote for it right now instead of fabricating numbers.
- Never claim to have real-time access beyond what's explicitly given to you in the MARKET DATA block.

ANALYSIS STRUCTURE
When asked to analyze a specific coin, structure your answer along these lines (adapt naturally, don't force rigid headers for short casual questions):
1. Snapshot — current price, 24h change, market cap, and rank if available.
2. Background — when/how the project launched, what problem it solves, pivotal historical moments.
3. Historical performance — notable rallies, major drawdowns from all-time highs, current price vs historical support/resistance zones.
4. Market read — a plain-language read on momentum/sentiment based on the data you have. Speak qualitatively; don't pretend to run indicators you don't have data for.
5. Risk assessment — key risks (volatility, regulation, competition, liquidity, project-specific risk) stated plainly.
6. Always end analysis-style answers with a brief one-line "not financial advice, do your own research" disclaimer, translated into the user's language.

STYLE RULES
- Be honest about uncertainty. Never present a prediction as a guarantee.
- Do not give specific "buy now" / "sell now" instructions — describe scenarios and things to watch instead.
- When comparing two coins, use a clear side-by-side structure (short bullet lists) rather than long prose.
- Format numbers cleanly (e.g. $67,240, +3.4%, $1.28T market cap).
- If the user sends an image (chart, screenshot, token stats page), read it carefully and describe what's shown before giving your take, and be explicit about what you can and can't tell from the image alone.`;

// =============================================================================
//  Market data helpers (CoinGecko + Binance)
// =============================================================================
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
  shib: 'shiba-inu',
  ltc: 'litecoin', litecoin: 'litecoin',
  uni: 'uniswap', uniswap: 'uniswap',
  atom: 'cosmos', cosmos: 'cosmos',
  xlm: 'stellar', stellar: 'stellar',
  near: 'near',
  apt: 'aptos', aptos: 'aptos',
  arb: 'arbitrum', arbitrum: 'arbitrum',
  op: 'optimism', optimism: 'optimism',
  fil: 'filecoin', filecoin: 'filecoin',
  etc: 'ethereum-classic',
  icp: 'internet-computer',
  pepe: 'pepe',
  sui: 'sui',
  inj: 'injective-protocol', injective: 'injective-protocol',
};
const SYMBOL_BY_ID = Object.entries(COIN_MAP).reduce((acc, [key, id]) => {
  if (key.length <= 5 && !acc[id]) acc[id] = key.toUpperCase();
  return acc;
}, {});

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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request to ${url} failed with ${res.status}`);
  return res.json();
}

async function getCoinGeckoData(coinId) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const data = await fetchJson(url);
  const md = data.market_data || {};
  return {
    symbol: (data.symbol || '').toUpperCase(),
    name: data.name,
    genesisDate: data.genesis_date || null,
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
  };
}

async function getBinance24hr(symbol) {
  const pair = `${symbol.toUpperCase()}USDT`;
  const data = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`);
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

async function buildMarketContext(text) {
  const coinIds = detectCoinMentions(text);
  if (!coinIds.length) return '';

  const blocks = await Promise.all(
    coinIds.map(async (id) => {
      const symbol = SYMBOL_BY_ID[id] || id.toUpperCase();
      const [gecko, binance] = await Promise.allSettled([getCoinGeckoData(id), getBinance24hr(symbol)]);
      const g = gecko.status === 'fulfilled' ? gecko.value : null;
      const b = binance.status === 'fulfilled' ? binance.value : null;
      if (!g && !b) return null;

      const lines = [`Coin: ${g ? g.name : symbol} (${symbol})`];
      if (b) {
        lines.push(`Live price (Binance, ${b.pair}): $${b.lastPrice}`);
        lines.push(`24h change: ${b.priceChangePercent}%  |  24h high: $${b.highPrice}  |  24h low: $${b.lowPrice}`);
        lines.push(`24h quote volume: $${Math.round(b.quoteVolume).toLocaleString('en-US')}`);
      } else if (g && g.priceUsd != null) {
        lines.push(`Price (CoinGecko): $${g.priceUsd}  |  24h change: ${g.change24h}%`);
      }
      if (g) {
        if (g.marketCapUsd) lines.push(`Market cap: $${Math.round(g.marketCapUsd).toLocaleString('en-US')} (rank #${g.marketCapRank ?? 'N/A'})`);
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

// =============================================================================
//  Gemini
// =============================================================================
let genAI = null;
function getModel() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set. Add it in your Render environment variables.');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: SYSTEM_PROMPT });
}

function formatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && m.text)
    .map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] }));
}

function buildUserParts(message, marketContext, imageBase64) {
  const parts = [];
  if (imageBase64) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageBase64);
    if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
  }
  const textPieces = [];
  if (marketContext) textPieces.push(marketContext);
  textPieces.push(message || (imageBase64 ? 'Please analyze this image.' : ''));
  parts.push({ text: textPieces.join('\n\n') });
  return parts;
}

async function generateReply({ message, history, marketContext, imageBase64 }) {
  const chat = getModel().startChat({ history: formatHistory(history) });
  const result = await chat.sendMessage(buildUserParts(message, marketContext, imageBase64));
  return result.response.text();
}

async function* generateReplyStream({ message, history, marketContext }) {
  const chat = getModel().startChat({ history: formatHistory(history) });
  const result = await chat.sendMessageStream(buildUserParts(message, marketContext, null));
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

// =============================================================================
//  Routes
// =============================================================================
function parseHistory(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message = '', history, imageBase64 } = req.body || {};
    const marketContext = await buildMarketContext(message).catch(() => '');
    const reply = await generateReply({ message, history: parseHistory(history), marketContext, imageBase64 });
    res.json({ reply });
  } catch (err) {
    console.error('[/api/chat] error:', err);
    res.status(500).json({ error: 'Something went wrong generating a reply. Please try again.' });
  }
});

app.get('/api/stream', async (req, res) => {
  const message = typeof req.query.message === 'string' ? req.query.message : '';
  const history = parseHistory(req.query.history);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.on('close', () => { closed = true; });

  try {
    const marketContext = await buildMarketContext(message).catch(() => '');
    let full = '';
    for await (const chunk of generateReplyStream({ message, history, marketContext })) {
      if (closed) break;
      full += chunk;
      send('delta', { text: chunk });
    }
    if (!closed) { send('done', { full }); res.end(); }
  } catch (err) {
    console.error('[/api/stream] error:', err);
    if (!closed) { send('error', { error: 'Connection error. Please try again.' }); res.end(); }
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Chat Crypto backend listening on port ${PORT}`);
});