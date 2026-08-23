# Chat Crypto — Ամբողջական Telegram Mini App

AI-ով աշխատող կրիպտո-վերլուծական Telegram Mini App՝ Claude API-ի (5 խելացի tool-ֆունկցիա) և Binance-ի իրական տվյալների հիման վրա։

---

## 📁 Folder Structure

```
chatcrypto/
├── server.js            ← Backend (Express). AI ագենտի "ուղեղը" + Binance տվյալներ
├── bot.js                ← Telegram Bot (@Chat_Crypto_Agent_Bot). Բացում է Mini App-ը
├── package.json          ← Node.js dependency-ների ցանկ
├── .env.example          ← Կարգավորումների նմուշ (պատճենիր որպես .env)
├── .env                  ← (դու ես ստեղծում) Իրական գաղտնի բանալիներ — ԵՐԲԵՔ մի՛ share արա
├── README.md              ← Այս ֆայլը
└── public/
    ├── index.html         ← Frontend (Mini App-ի ամբողջ UI՝ HTML+CSS+JS մեկ ֆայլում)
    └── assets/
        └── chat-crypto-logo.png  ← (դու ես ավելացնում) Chat Crypto-ի լոգոն
```

### Ինչու է կառուցվածքն այսպես

| Ֆայլ | Դեր | Ինչու է առանձին |
|---|---|---|
| `server.js` | AI logic, Binance API, HTTP endpoint-ներ | Սա այն «worker»-ն է, որին Telegram-ը/browser-ը իրականում խոսում է |
| `bot.js` | Telegram-ի հետ խոսակցություն (polling) | Առանձին process է, քանի որ Telegram-ի bot API-ն և web server-ը տարբեր life-cycle ունեն |
| `public/index.html` | Ինտերֆեյս | `server.js`-ը այն սպասարկում է որպես static ֆայլ browser/Telegram WebView-ի համար |
| `.env` | Գաղտնիքներ | Երբեք չի commit-վում Git-ում, պահվում է միայն քո սերվերի վրա |

---

## ⚙️ Ինչպես աշխատում է ամբողջությամբ

```
Օգտատեր Telegram-ում
   │
   │ 1) գրում է /start բոտին
   ▼
bot.js (@Chat_Crypto_Agent_Bot)
   │
   │ 2) ցույց է տալիս "🚀 Բացել Chat Crypto" WebApp կոճակը
   ▼
Օգտատերը սեղմում է կոճակը
   │
   │ 3) Telegram-ը բացում է MINI_APP_URL-ը (webview-ի ներսում)
   ▼
public/index.html (server.js-ից սպասարկվող)
   │
   │ 4) օգտատերը գրում է հարց ("BTC-ն կաճի՞")
   ▼
POST /api/chat → server.js
   │
   │ 5) server.js-ը կանչում է Claude API-ին (tool-calling)
   │    Claude-ն ինքն է որոշում՝ պետք է analyze_coin կանչել
   ▼
server.js-ը կանչում է Binance API (իրական գներ/klines)
   │
   │ 6) տվյալները վերադառնում են Claude-ին, Claude-ն կազմում է վերջնական պատասխանը
   ▼
Պատասխանը վերադառնում է օգտատիրոջը՝ ընտրված լեզվով
```

---

## 🚀 Տեղադրում քայլ առ քայլ

### 1. Բանալիներ ստանալ

- **Anthropic API key** → https://console.anthropic.com/settings/keys
- **Telegram Bot token** → @BotFather-ում `/mybots` → ընտրիր բոտը → **API Token** → **Revoke current token**-ով նոր token ստացիր (հին token-ը այլևս վավեր չէ)

### 2. `.env` ֆայլի ստեղծում

```bash
cp .env.example .env
```

Բացիր `.env`-ը և լրացրու.
```
ANTHROPIC_API_KEY=sk-ant-...        ← քո իրական բանալին
TELEGRAM_BOT_TOKEN=...              ← BotFather-ից ստացած ՆՈՐ token-ը
MINI_APP_URL=https://...            ← deploy-ից հետո ստացած https հասցեն (քայլ 4-ից)
```

### 3. Dependency-ների տեղադրում

```bash
npm install
```

### 4. Backend-ի deploy (Render/Railway/VPS)

Deploy արա `server.js`-ը որևէ hosting-ի վրա (Render, Railway, VPS և այլն)՝ `npm start` start command-ով։ Deploy-ից հետո կստանաս https հասցե (օր. `https://chatcrypto.onrender.com`) — դա գրիր `.env`-ի `MINI_APP_URL`-ի մեջ։

> `server.js`-ը ինքնաբավ է. եթե `public/index.html`-ը բացակայում է hosting-ի վրա, backend-ն ինքն է այն ստեղծում գործարկման պահին (embedded կոպիայից)։

### 5. Bot-ի գործարկում

Առանձին process-ով (կամ առանձին background service-ով hosting-ի վրա).
```bash
npm run bot
```

### 6. BotFather-ում Mini App-ի կապակցում (կամընտիր, բայց խորհուրդ է տրվում)

`/mybots` → ընտրիր բոտը → **Bot Settings** → **Menu Button** → **Configure Menu Button** → տուր `MINI_APP_URL`-ը։ Այսպես Mini App-ը կերևա նաև bot-ի chat պատուհանի ներքևի ձախ կոճակի տեղում։

---

## 🧠 Ագենտի 5 խելացի ֆունկցիաները

| Ֆունկցիա | Ինչ է անում |
|---|---|
| `analyze_coin` | RSI(14), SMA20/50, տրենդի ազդանշան՝ Binance klines-ից |
| `risk_calculator` | Leverage-ով liquidation գին, ռիսկի հեռավորություն, առաջարկվող position size |
| `market_overview` | Top 5 gainers/losers, market breadth |
| `compare_coins` | Երկու coin-ի կողք-կողքի տեխնիկական համեմատություն |
| `portfolio_simulator` | Հիպոթետիկ գործարքի PnL հաշվարկ |

---

## 🔒 Անվտանգության կանոններ

1. `.env` ֆայլը **երբեք** մի՛ push արա GitHub-ում (ավելացրու `.gitignore`-ում)։
2. Եթե token/key-ը պատահաբար հրապարակվեց (chat-ում, screenshot-ում, GitHub-ում), անմիջապես **revoke** արա (BotFather-ում՝ `/revoke`, Anthropic Console-ում՝ delete key) և ստացիր նոր։
3. `TELEGRAM_BOT_TOKEN`-ը և `ANTHROPIC_API_KEY`-ը գաղտնիքներ են՝ հավասար նշանակությամբ ինչպես բանկային գաղտնաբառը։

---

## 🛠️ Troubleshooting

| Սխալ | Պատճառ | Լուծում |
|---|---|---|
| `Cannot GET /` | Static path սխալ | Արդեն ուղղված է (`__dirname` + fallback route) |
| `index.html չի գտնվել` | `public/` folder-ը deploy-ի ժամանակ բացակայել է | Ինքնաբերաբար ստեղծվում է (embedded fallback) |
| «Կապ չհաջողվեց» + `[Debug: ...]` | Սովորաբար `ANTHROPIC_API_KEY` սխալ/բացակա | Ստուգիր `.env`-ը, վերագործարկիր server-ը |
| Bot-ը չի արձագանքում | `TELEGRAM_BOT_TOKEN` սխալ կամ `bot.js` չգործարկված | `npm run bot`, ստուգիր console output-ը |
| WebApp կոճակը չի բացվում | `MINI_APP_URL`-ը http է, ոչ https | Telegram WebApp-ը պահանջում է **https** |
