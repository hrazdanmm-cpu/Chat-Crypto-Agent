import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BINANCE = 'https://api.binance.com';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const cache = new Map();
const ttl = (key, ms, getter) => {
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < ms) return saved.value;
  return getter().then(value => (cache.set(key, { at: Date.now(), value }), value));
};

app.use(express.json({ limit: '6mb' }));
app.use(express.static(__dirname, { index: 'index.html' }));

const json = async url => {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
};
const symbolFrom = text => {
  const match = String(text).toUpperCase().match(/\b(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|TON|LINK|SUI|APT|DOT|TRX|LTC|ATOM|NEAR|OP|ARB|PEPE|SHIB|FET|AAVE|UNI|MATIC|POL)\b/);
  return match?.[1] || null;
};
const fmt = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 });

async function binanceTickers() {
  return ttl('tickers', 25_000, async () => {
    const all = await json(`${BINANCE}/api/v3/ticker/24hr`);
    return all.filter(x => x.symbol.endsWith('USDT') && Number(x.lastPrice) > 0)
      .map(x => ({ symbol: x.symbol.slice(0, -4), pair: x.symbol, name: x.symbol.slice(0, -4), price: Number(x.lastPrice), change24h: Number(x.priceChangePercent), volume: Number(x.quoteVolume) }))
      .sort((a, b) => b.volume - a.volume);
  });
}
async function marketData(symbol) {
  const pair = `${symbol}USDT`;
  const [ticker, klines] = await Promise.all([
    json(`${BINANCE}/api/v3/ticker/24hr?symbol=${pair}`),
    json(`${BINANCE}/api/v3/klines?symbol=${pair}&interval=4h&limit=100`)
  ]);
  const closes = klines.map(k => Number(k[4]));
  const highs = klines.map(k => Number(k[2]));
  const lows = klines.map(k => Number(k[3]));
  const last = closes.at(-1), average = closes.reduce((a, b) => a + b, 0) / closes.length;
  const support = Math.min(...lows.slice(-30)), resistance = Math.max(...highs.slice(-30));
  const rsi = calculateRsi(closes, 14);
  return { symbol, price: Number(ticker.lastPrice), change24h: Number(ticker.priceChangePercent), high24h: Number(ticker.highPrice), low24h: Number(ticker.lowPrice), volume: Number(ticker.quoteVolume), support, resistance, rsi, trend: last >= average ? 'bullish / above 100×4h average' : 'bearish / below 100×4h average' };
}
function calculateRsi(prices, period) {
  const changes = prices.slice(-period - 1).slice(1).map((p, i) => p - prices.slice(-period - 1)[i]);
  const gain = changes.reduce((sum, n) => sum + Math.max(n, 0), 0) / period;
  const loss = changes.reduce((sum, n) => sum + Math.max(-n, 0), 0) / period;
  return loss === 0 ? 100 : Math.round((100 - 100 / (1 + gain / loss)) * 10) / 10;
}
function localAnalysis(data, language) {
  const bullish = data.price > (data.support + data.resistance) / 2 && data.rsi < 70;
  const direction = bullish ? 'վերականգնման/աճի' : 'անկման կամ տատանման';
  if (language === 'ru') return `${data.symbol}: $${fmt(data.price)} (${data.change24h >= 0 ? '+' : ''}${data.change24h.toFixed(2)}% за 24ч)\n\nТехническая сводка: RSI(14) ${data.rsi}; тренд ${data.trend}; поддержка около $${fmt(data.support)}, сопротивление около $${fmt(data.resistance)}.\n\nСценарий: текущие данные склоняются к ${bullish ? 'осторожно позитивному' : 'осторожно негативному/нейтральному'} сценарию, но это не гарантия. Закрепление выше сопротивления при объёме усиливает бычий тезис; уход ниже поддержки его отменяет.\n\nНе финансовый совет.`;
  if (language === 'en') return `${data.symbol}: $${fmt(data.price)} (${data.change24h >= 0 ? '+' : ''}${data.change24h.toFixed(2)}% in 24h)\n\nTechnical snapshot: RSI(14) ${data.rsi}; trend ${data.trend}; support near $${fmt(data.support)}, resistance near $${fmt(data.resistance)}.\n\nScenario: current data lean ${bullish ? 'cautiously constructive' : 'cautiously bearish/neutral'}, not guaranteed. A volume-backed close above resistance strengthens the bullish case; a loss of support invalidates it.\n\nNot financial advice.`;
  return `${data.symbol}՝ $${fmt(data.price)} (${data.change24h >= 0 ? '+' : ''}${data.change24h.toFixed(2)}%՝ 24 ժամում)\n\nՏեխնիկական ամփոփում՝ RSI(14)՝ ${data.rsi}, թրենդ՝ ${data.trend}, աջակցություն՝ մոտ $${fmt(data.support)}, դիմադրություն՝ մոտ $${fmt(data.resistance)}։\n\nՀավանականային սցենար՝ ներկա տվյալները ավելի շատ հուշում են ${direction} սցենար, բայց դա երաշխիք չէ։ Դիմադրությունից վեր՝ ծավալով փակվելը ուժեղացնում է աճի վարկածը, իսկ աջակցությունից ցածր գնալը այն չեղարկում է։\n\nՍա կրթական վերլուծություն է, ոչ ֆինանսական խորհուրդ։`;
}
const system = `You are Chat Crypto, an Armenian-created crypto-market analyst. Creator: Artur. You are crypto-only; politely redirect unrelated questions. Reply in the user's language; if Armenian Latin transliteration is used, reply Armenian script. Use supplied live market data exactly and never invent prices. Explain bullish, bearish, and neutral scenarios as probabilities, never as a guarantee or personal investment instruction. Include concise history/context, support/resistance, technical and market factors, risks, invalidation, and Not Financial Advice. Do not claim a coin will definitely rise or fall.`;
function writeSse(res, token) { res.write(`data: ${JSON.stringify({ token })}\n\n`); }

app.get('/api/health', (_, res) => res.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) }));
app.get('/api/config', (_, res) => res.json({ futuresCalculatorUrl: process.env.FUTURES_CALCULATOR_URL || 'https://t.me/Block_News_Crypto_bot' }));
app.get('/api/coins', async (req, res) => {
  try { const list = await binanceTickers(); res.json(req.query.sort === 'gainers' ? [...list].sort((a, b) => b.change24h - a.change24h) : list); }
  catch (error) { res.status(502).json({ error: 'Unable to load Binance market list' }); }
});
app.post('/api/chat', async (req, res) => {
  const { message = '', language = 'hy', history = [], image } = req.body || {};
  if (!String(message).trim()) return res.status(400).json({ error: 'message is required' });
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const symbol = symbolFrom(message);
  let data = null;
  try { if (symbol) data = await marketData(symbol); } catch { /* AI can still answer without a quote. */ }
  const marketContext = data ? `LIVE BINANCE DATA (timestamp ${new Date().toISOString()}):\n${JSON.stringify(data)}` : 'No specific Binance symbol detected. Ask the user which cryptocurrency or ticker they want analyzed.';
  const calculatorUrl = process.env.FUTURES_CALCULATOR_URL || 'https://t.me/Block_News_Crypto_bot';
  const userQuestionCount = history.filter(x => x.role === 'user').length;
  const calculatorHint = userQuestionCount > 0 && userQuestionCount % 5 === 0
    ? `\n\n🧮 Futures Calculator Mini App խորհուրդ՝ դիրքի չափի, liquidation price-ի, R:R-ի և funding-ի հաշվարկի համար՝ ${calculatorUrl}` : '';
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const parts = [{ text: `${system}\n\n${marketContext}\n\nUser: ${message}` }];
    if (typeof image === 'string' && image.startsWith('data:image/')) {
      const [meta, encoded] = image.split(',');
      parts.push({ inlineData: { mimeType: meta.match(/data:(.*?);/)?.[1] || 'image/png', data: encoded } });
    }
    const stream = await ai.models.generateContentStream({ model: process.env.GEMINI_MODEL || 'gemini-3.7-flash', contents: [{ role: 'user', parts }] });
    for await (const chunk of stream) writeSse(res, chunk.text || '');
    writeSse(res, calculatorHint);
  } catch (error) {
    const reply = data ? localAnalysis(data, language) : (language === 'hy' ? 'Նշեք կոնկրետ կրիպտոարժույթ (օր.՝ BTC, ETH կամ SOL), և կտամ շուկայական տվյալներով կառուցված վերլուծություն։' : language === 'ru' ? 'Укажите конкретную криптовалюту, например BTC, ETH или SOL, и я дам анализ на основе рыночных данных.' : 'Name a specific cryptocurrency, such as BTC, ETH, or SOL, and I will provide a market-data-based analysis.');
    writeSse(res, reply + calculatorHint);
    console.warn('AI fallback:', error.message);
  }
  res.write('data: [DONE]\n\n');
  res.end();
});
app.listen(PORT, () => console.log(`Chat Crypto listening on http://localhost:${PORT}`));
