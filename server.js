// ============================================================================
//  Chat Crypto — Backend (Node.js / Express)
//  Ագենտի 5 խելացի ֆունկցիաներով (Claude tool-use) + Binance շուկայի տվյալներ
// ============================================================================
'use strict';

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static('public')); // index.html և assets/ դնել այս թղթապանակում

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const FUTURES_CALCULATOR_URL =
  process.env.FUTURES_CALCULATOR_URL || 'https://t.me/Block_News_Crypto_bot';
const BINANCE_BASE = 'https://api.binance.com';

// ---------------------------------------------------------------------------
// Փոքր in-memory քեշ (Binance-ի ավելորդ հարցումներից խուսափելու համար)
// ---------------------------------------------------------------------------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { value, at: Date.now() });
  return value;
}

// ---------------------------------------------------------------------------
// Binance helper-ներ
// ---------------------------------------------------------------------------
async function fetchAllTickers() {
  return cached('tickers24h', 15_000, async () => {
    const r = await fetch(`${BINANCE_BASE}/api/v3/ticker/24hr`);
    if (!r.ok) throw new Error('Binance ticker error ' + r.status);
    const data = await r.json();
    return data
      .filter((x) => x.symbol.endsWith('USDT') && Number(x.lastPrice) > 0)
      .map((x) => ({
        symbol: x.symbol.slice(0, -4),
        name: x.symbol.slice(0, -4),
        price: Number(x.lastPrice),
        change24h: Number(x.priceChangePercent),
        high24h: Number(x.highPrice),
        low24h: Number(x.lowPrice),
        volume: Number(x.quoteVolume),
      }));
  });
}

async function fetchKlines(symbol, interval = '1h', limit = 100) {
  const pair = `${symbol.toUpperCase()}USDT`;
  return cached(`klines:${pair}:${interval}:${limit}`, 30_000, async () => {
    const r = await fetch(
      `${BINANCE_BASE}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`
    );
    if (!r.ok) throw new Error(`Binance klines error for ${pair}: ${r.status}`);
    const raw = await r.json();
    return raw.map((k) => ({
      openTime: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
  });
}

// ---------------------------------------------------------------------------
// Տեխնիկական ինդիկատորներ
// ---------------------------------------------------------------------------
function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0,
    losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function trendSignal({ price, sma20, sma50, rsiValue }) {
  let score = 0;
  if (sma20 && sma50) score += sma20 > sma50 ? 1 : -1;
  if (sma20 && price > sma20) score += 1;
  if (sma20 && price < sma20) score -= 1;
  if (rsiValue !== null) {
    if (rsiValue > 70) score -= 1; // overbought
    if (rsiValue < 30) score += 1; // oversold
  }
  if (score >= 2) return 'bullish';
  if (score <= -2) return 'bearish';
  return 'neutral';
}

// ============================================================================
//  5 ԽԵԼԱՑԻ ՖՈՒՆԿՑԻԱՆԵՐ (Claude tool-use definitions)
// ============================================================================
const TOOLS = [
  {
    name: 'analyze_coin',
    description:
      'Կատարում է կոնկրետ կրիպտոարժույթի տեխնիկական վերլուծություն (գին, RSI, SMA20/50, տրենդ, ազդանշան) Binance-ի իրական տվյալների հիման վրա։ Օգտագործիր, երբ օգտատերը հարցնում է կոնկրետ մետաղադրամի աճելու/ընկնելու հեռանկարի մասին։',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Կրիպտոարժույթի կոդը, օր. BTC, ETH, SOL' },
        interval: {
          type: 'string',
          description: 'Ժամանակային շրջանակ (1h, 4h, 1d)',
          enum: ['15m', '1h', '4h', '1d'],
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'risk_calculator',
    description:
      'Հաշվարկում է լիկվիդացիայի գին, ռիսկի չափը և պոզիցիայի օպտիմալ չափը ֆյուչերսային գործարքի համար (leverage-ով)։ Օգտագործիր, երբ օգտատերը հարցնում է ռիսկերի, leverage-ի կամ liquidation-ի մասին։',
    input_schema: {
      type: 'object',
      properties: {
        entryPrice: { type: 'number', description: 'Մուտքի գին' },
        leverage: { type: 'number', description: 'Լծակ (օր. 5, 10, 20)' },
        direction: { type: 'string', enum: ['long', 'short'] },
        accountBalance: { type: 'number', description: 'Հաշվի հասանելի հաշվեկշիռ (USDT)' },
        riskPercent: {
          type: 'number',
          description: 'Ընդունելի ռիսկը հաշվեկշռից %, օր. 2',
        },
      },
      required: ['entryPrice', 'leverage', 'direction'],
    },
  },
  {
    name: 'market_overview',
    description:
      'Վերադարձնում է շուկայի ընդհանուր պատկերը՝ top gainers, top losers, ընդհանուր breadth (քանի մետաղադրամ է աճում vs նվազում)։ Օգտագործիր ընդհանուր շուկայի տրամադրության հարցերի համար։',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'compare_coins',
    description:
      'Համեմատում է երկու կրիպտոարժույթ գնի, 24ժ փոփոխության, ծավալի և տեխնիկական ցուցանիշների առումով։ Օգտագործիր "X vs Y" տիպի հարցերի համար։',
    input_schema: {
      type: 'object',
      properties: {
        symbolA: { type: 'string' },
        symbolB: { type: 'string' },
      },
      required: ['symbolA', 'symbolB'],
    },
  },
  {
    name: 'portfolio_simulator',
    description:
      'Սիմուլացնում է հիպոթետիկ գործարքի արդյունքը (PnL) ելնելով մուտքի գնից, ելքի գնից, պոզիցիայի չափից և leverage-ից։ Օգտագործիր, երբ օգտատերը հարցնում է "եթե ես գնեմ X-ով և վաճառեմ Y-ով, որքա՞ն կշահեմ/կկորցնեմ"։',
    input_schema: {
      type: 'object',
      properties: {
        entryPrice: { type: 'number' },
        exitPrice: { type: 'number' },
        positionSizeUsdt: { type: 'number' },
        leverage: { type: 'number' },
        direction: { type: 'string', enum: ['long', 'short'] },
      },
      required: ['entryPrice', 'exitPrice', 'positionSizeUsdt'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handler-ներ (իրական հաշվարկ/տվյալ)
// ---------------------------------------------------------------------------
async function runTool(name, input) {
  switch (name) {
    case 'analyze_coin': {
      const interval = input.interval || '1h';
      const klines = await fetchKlines(input.symbol, interval, 100);
      const closes = klines.map((k) => k.close);
      const price = closes[closes.length - 1];
      const sma20 = sma(closes, 20);
      const sma50 = sma(closes, 50);
      const rsiValue = rsi(closes, 14);
      const signal = trendSignal({ price, sma20, sma50, rsiValue });
      const change = ((price - closes[0]) / closes[0]) * 100;
      return {
        symbol: input.symbol.toUpperCase(),
        interval,
        price,
        sma20,
        sma50,
        rsi: rsiValue,
        periodChangePercent: Number(change.toFixed(2)),
        signal,
      };
    }
    case 'risk_calculator': {
      const { entryPrice, leverage, direction, accountBalance, riskPercent } = input;
      const maintenanceMargin = 0.005; // 0.5% պայմանական
      const liqDistance = entryPrice * (1 / leverage - maintenanceMargin);
      const liquidationPrice =
        direction === 'long' ? entryPrice - liqDistance : entryPrice + liqDistance;
      let suggestedPositionSize = null;
      if (accountBalance && riskPercent) {
        const riskAmount = accountBalance * (riskPercent / 100);
        suggestedPositionSize = Number((riskAmount * leverage).toFixed(2));
      }
      return {
        entryPrice,
        leverage,
        direction,
        liquidationPrice: Number(liquidationPrice.toFixed(6)),
        liquidationDistancePercent: Number(((liqDistance / entryPrice) * 100).toFixed(2)),
        suggestedPositionSizeUsdt: suggestedPositionSize,
        note: 'Մոտավոր հաշվարկ է. Ճշգրիտ liquidation-ը կախված է բորսայի կոնկրետ ֆորմուլայից և fee-ներից։',
      };
    }
    case 'market_overview': {
      const tickers = await fetchAllTickers();
      const sorted = [...tickers].sort((a, b) => b.change24h - a.change24h);
      const gainers = sorted.slice(0, 5);
      const losers = sorted.slice(-5).reverse();
      const advancing = tickers.filter((t) => t.change24h > 0).length;
      const declining = tickers.filter((t) => t.change24h < 0).length;
      return {
        totalCoins: tickers.length,
        advancing,
        declining,
        breadthPercent: Number(((advancing / tickers.length) * 100).toFixed(1)),
        topGainers: gainers,
        topLosers: losers,
      };
    }
    case 'compare_coins': {
      const [a, b] = await Promise.all([
        runTool('analyze_coin', { symbol: input.symbolA, interval: '1h' }),
        runTool('analyze_coin', { symbol: input.symbolB, interval: '1h' }),
      ]);
      return { coinA: a, coinB: b };
    }
    case 'portfolio_simulator': {
      const { entryPrice, exitPrice, positionSizeUsdt, leverage = 1, direction = 'long' } = input;
      const priceChangePercent = ((exitPrice - entryPrice) / entryPrice) * 100;
      const directional = direction === 'long' ? priceChangePercent : -priceChangePercent;
      const pnlPercent = directional * leverage;
      const pnlUsdt = Number(((positionSizeUsdt * pnlPercent) / 100).toFixed(2));
      return {
        entryPrice,
        exitPrice,
        direction,
        leverage,
        priceChangePercent: Number(priceChangePercent.toFixed(2)),
        pnlPercent: Number(pnlPercent.toFixed(2)),
        pnlUsdt,
        finalBalanceEstimate: Number((positionSizeUsdt + pnlUsdt).toFixed(2)),
      };
    }
    default:
      throw new Error('Unknown tool: ' + name);
  }
}

// ---------------------------------------------------------------------------
// Համակարգային պրոմպթ
// ---------------------------------------------------------------------------
function systemPrompt(language, recommendFutures) {
  const base = `Դու "Chat Crypto"-ի AI կրիպտո-վերլուծաբանն ես՝ Telegram Mini App-ի համար։
Պատասխանիր օգտատիրոջ լեզվով (${language})։ Եղիր հակիրճ, հստակ, մասնագիտական և միշտ հիշեցրու,
որ սա կրթական տեղեկություն է, ոչ ֆինանսական խորհուրդ։ Կոնկրետ մետաղադրամի հարցերի դեպքում
օգտագործիր տրված գործիքները (analyze_coin, compare_coins, market_overview, risk_calculator,
portfolio_simulator)՝ իրական տվյալների վրա հիմնված պատասխան տալու համար, երբեք մի հորինիր գներ։`;
  const futuresNote = recommendFutures
    ? `\n\nԱյս պատասխանի վերջում, բնական և կարճ ձևով, խորհուրդ տուր օգտատիրոջը փորձել
"Futures Calculator Mini App"-ը (${FUTURES_CALCULATOR_URL})՝ նշելով, որ այն օգնում է
լիկվիդացիայի մոդելավորման, ռիսկերի կառավարման և Binance-ի իրական ժամանակի տվյալների հարցում։`
    : '';
  return base + futuresNote;
}

// ---------------------------------------------------------------------------
// Claude API կանչ (tool-use loop)
// ---------------------------------------------------------------------------
async function callClaude(messages, language, recommendFutures) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  let conversation = messages;
  for (let step = 0; step < 4; step++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        system: systemPrompt(language, recommendFutures),
        messages: conversation,
        tools: TOOLS,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Claude API error ${r.status}: ${errText}`);
    }
    const data = await r.json();
    const toolUses = data.content.filter((b) => b.type === 'tool_use');

    if (toolUses.length === 0) {
      return data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    }

    // Կատարել գործիքները և ուղարկել արդյունքները հետ
    const toolResults = await Promise.all(
      toolUses.map(async (t) => {
        try {
          const result = await runTool(t.name, t.input);
          return { type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(result) };
        } catch (err) {
          return {
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify({ error: String(err.message || err) }),
            is_error: true,
          };
        }
      })
    );

    conversation = [
      ...conversation,
      { role: 'assistant', content: data.content },
      { role: 'user', content: toolResults },
    ];
  }
  return 'Ներողություն, պատասխանը կազմելիս սխալ առաջացավ։ Փորձեք կրկին։';
}

// ============================================================================
//  API ROUTES
// ============================================================================

app.get('/api/config', (req, res) => {
  res.json({ futuresCalculatorUrl: FUTURES_CALCULATOR_URL });
});

app.get('/api/coins', async (req, res) => {
  try {
    const sortMode = req.query.sort || 'volume';
    const tickers = await fetchAllTickers();
    const sorted = [...tickers].sort((a, b) =>
      sortMode === 'gainers' ? b.change24h - a.change24h : b.volume - a.volume
    );
    res.json(sorted.slice(0, 350)); // Binance-ի մեծ մասը (300+)
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, language = 'en', history = [], image } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    // «Ամեն 5-րդ պատասխանից հետո» Futures Calculator-ի առաջարկություն
    const assistantTurns = history.filter((m) => m.role === 'assistant').length;
    const recommendFutures = (assistantTurns + 1) % 5 === 0;

    const userContent = [{ type: 'text', text: message }];
    if (image && typeof image === 'string' && image.startsWith('data:image')) {
      const [, mediaType, base64Data] = image.match(/^data:(.+);base64,(.*)$/) || [];
      if (base64Data) {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data },
        });
      }
    }

    const conversation = [
      ...history.slice(-10).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text,
      })),
      { role: 'user', content: userContent },
    ];

    const reply = await callClaude(conversation, language, recommendFutures);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Chat Crypto backend listening on port ${PORT}`);
});
