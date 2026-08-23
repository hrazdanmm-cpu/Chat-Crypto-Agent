# Chat Crypto — Telegram Mini App

## Run locally

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`, then set `GEMINI_API_KEY`.
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3000` (not the `file://` HTML path).

Opening `index.html` directly cannot reach `/api/chat`; that is why the earlier page showed the server-connection fallback. The Express server serves both the UI and API on one origin.

## API

- `GET /api/health` — server/AI configuration state.
- `GET /api/coins` — Binance USDT spot pairs, current price and 24h change.
- `POST /api/chat` — SSE streaming response. The backend injects Binance live price, 24h change, high/low, volume, 4h RSI, and support/resistance when it detects a supported ticker.

## Deploy to Render

Push the contents of this folder to GitHub, create a Render Web Service, use build command `npm install`, and start command `npm start`. Add the `.env` variables in Render's Environment section; never commit them.

`FUTURES_CALCULATOR_URL` defaults to `https://t.me/Block_News_Crypto_bot`. The menu opens it in Telegram and the backend recommends it after every fifth user question.

All directional commentary is probabilistic educational analysis, not a price guarantee or financial advice.
