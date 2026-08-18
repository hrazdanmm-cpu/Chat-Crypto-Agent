# Chat Crypto — Telegram Mini App

An AI crypto analyst chat, built as a Telegram Mini App. Frontend is a single
mobile-first HTML page; backend is Node/Express, talks to Gemini 1.5 Flash for
the AI, and to CoinGecko + Binance for live market data.

```
project/
├── server.js              Express server: /api/chat, /api/stream
├── lib/
│   ├── geminiService.js    Gemini 1.5 Flash integration (streaming + non-streaming)
│   └── marketService.js    Coin detection + CoinGecko/Binance data fetching
├── system_prompt.txt       The AI's persona & rules (crypto-analyst, multilingual, etc.)
├── public/index.html       The Mini App frontend
├── .env.example
└── package.json
```

## 1. Why you were seeing "⚠️ Connection error"

The frontend calls `POST /api/chat` and `GET /api/stream` on whatever server
it's hosted on. Those routes need this backend to be running — without it,
there's nothing to answer the request, so the app always shows the connection
error. This folder is that missing backend.

## 2. Get a free Gemini API key

1. Go to https://aistudio.google.com/app/apikey
2. Sign in and click **Create API key** (no cost on the free tier, with rate limits).
3. Copy the key.

## 3. Run it locally

```bash
cd project
cp .env.example .env
# open .env and paste your key into GEMINI_API_KEY=

npm install
npm start
```

Open http://localhost:3000 in a browser — you should be able to chat right away.
(Telegram-specific features like haptics and the `Telegram.WebApp` SDK simply
no-op outside of Telegram, so testing in a normal browser works fine.)

## 4. Deploy for free (Render)

1. Push this whole `project/` folder to a GitHub repository.
2. On https://render.com, click **New +** → **Web Service**, and connect the repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Under **Environment**, add `GEMINI_API_KEY` with your key (and `TELEGRAM_BOT_TOKEN`
   if you're wiring up a bot — see below). Render sets `PORT` automatically.
5. Deploy. You'll get a URL like `https://chat-crypto.onrender.com`.

Vercel works too, but Vercel's serverless functions don't keep a long-lived SSE
connection open as cleanly as a normal Node server — Render (or Railway/Fly.io)
is the simpler choice for the streaming `/api/stream` endpoint used here.

> **Free-tier note:** Render's free web services spin down after inactivity and
> take a few seconds to wake back up on the next request — the first message
> after idle time may feel slow. This is expected on the free tier.

## 5. Connect it to Telegram as a Mini App

1. Open **@BotFather** in Telegram → `/newbot` (or use an existing bot) → get your bot token.
2. `/mybots` → select your bot → **Bot Settings** → **Menu Button** → **Configure Menu Button**
   → paste your Render URL (e.g. `https://chat-crypto.onrender.com`).
3. Alternatively use `/newapp` under your bot to register a dedicated Mini App with that same URL.
4. Open your bot in Telegram and tap the menu button — Chat Crypto should load full-screen.

## 6. API usage / cost notes

- **Gemini 1.5 Flash free tier** — generous request-per-minute limits, no charge
  while under quota. See https://ai.google.dev/pricing for current limits.
- **CoinGecko public API** — free, no key required, rate-limited per IP; used
  for project background, market cap, ATH/ATL, launch date.
- **Binance public REST API** — free, no key required; used for the live spot
  price / 24h change shown in market snapshots and the in-chat coin picker.

## 7. Customizing the persona

Edit `system_prompt.txt` — it controls language auto-detection (including
reading Armenian typed in Latin letters and replying in Armenian script), the
"who made you" answer ("created by Artur"), the crypto-only scope, and the
analysis structure (background → historical performance → market read → risk
+ disclaimer). No code changes needed for wording tweaks.
