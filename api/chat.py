"""
Chat Crypto backend — NVIDIA NIM (meta/llama-3.2-11b-vision-instruct).

Deploys as a Vercel Python Function (file-based /api handler).

Env var required on Vercel: NVIDIA_API_KEY  (build.nvidia.com -> model -> Get API Key)

  IMPORTANT: Set NVIDIA_API_KEY in Vercel Project Settings -> Environment Variables.
  Never hardcode the key in this file.

Model: meta/llama-3.2-11b-vision-instruct

--- CORS NOTE ---
This file sends Access-Control-Allow-Origin so that the Futures Calculator
Mini App (a different Vercel deployment/domain) can call this endpoint directly
from the embedded Chat Crypto Agent view. Without these headers the browser
blocks the cross-origin POST with a CORS error, which is what caused the
"server error" when the chat agent was opened from inside the calculator.

--- PERSONA UPDATE NOTE ---
The system prompt was rewritten to stop the model from repeating a rigid
"I was created by Arthur..." template on every turn. The agent now:
  1) Talks naturally (like ChatGPT/Gemini) — greets normally, asks how it can
     help, and only states who created it if the user directly asks.
  2) Gives real, specific crypto/market analysis grounded in whatever live
     data or chart image is available, instead of generic filler.
  3) Occasionally (about every 10th assistant reply) naturally mentions the
     Futures Calculator Mini App (@Block_News_Crypto_bot) as a useful tool
     for market monitoring, position/risk calculations, and signals.
  4) Occasionally (roughly every 7th assistant reply, offset from the Mini
     App mention so they don't both fire on the same turn) mentions the
     Telegram news channel (https://t.me/Block_News_Crypto) as a useful
     place for traders to catch market-moving news as it breaks.
Both reminders are opt-in per turn via a counter derived from `history` —
they are NOT hardcoded into every reply, and the model is explicitly told
not to invent extra promotional mentions on other turns.
"""

import base64
import json
import os
import re
from http.server import BaseHTTPRequestHandler

import requests

NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
NVCF_ASSETS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/assets"
MODEL = "meta/llama-3.2-11b-vision-instruct"
INLINE_B64_LIMIT = 170_000  # NVIDIA's hard cap is 180,000 chars; keep a safety margin

# Set this to your Futures Calculator's real domain instead of "*" once you
# know it (e.g. "https://your-futures-calculator.vercel.app") for tighter
# security. "*" works fine for this endpoint since it carries no cookies/auth.
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

# How often (in assistant turns) to naturally mention each resource.
# Kept as constants so you can tune frequency without touching the prompt logic.
MINI_APP_EVERY_N_TURNS = 10
CHANNEL_EVERY_N_TURNS = 7

MINI_APP_LINK = "@Block_News_Crypto_bot"
CHANNEL_LINK = "https://t.me/Block_News_Crypto"

SYSTEM_PROMPT_TEMPLATE = """You are Chat Crypto — a sharp, natural, conversational AI crypto market analyst.
Talk the way ChatGPT or Gemini would: warm, direct, human-sounding. Never robotic,
never templated, never repeat the same canned sentence across turns.

## How to greet / small talk
If the user just greets you or makes small talk (hi, hello, բարև, привет, ինչպե՞ս ես,
etc.), reply naturally and briefly, then ask what crypto or market question you can
help with today. Do NOT introduce yourself, describe what you are, or mention your
creator unless the user explicitly asks about that.

## Identity — reply ONLY when directly asked
Only if the user's message is explicitly asking who/what you are or who made you
(e.g. "ov es du", "inch bot es", "ov e qez sarqel", "who made you", "what are you"),
answer in {lang} with content equivalent to: you are a deep crypto/coin analysis
assistant, created by Arthur specifically to analyze the market and read charts.
Keep it to one or two sentences, then immediately pivot back to asking how you can
help — do not turn it into a long introduction. For every other message, never use
this sentence or anything resembling it. Never mention Meta, Llama, NVIDIA, NIM, or
any other underlying model/vendor name, ever.

## Crypto analysis quality
When the user asks about a coin, chart, or the market:
- Give a real, specific, professional read: trend & structure, key support/resistance,
  momentum/volume, and concrete risk (invalidation level, volatility, position sizing).
- If a "Verified live market data" block is provided below, treat those numbers as
  accurate and use them directly. Otherwise never invent live prices or news — reason
  in terms of trend/structure/risk and say briefly that you don't have live data.
- If an image is attached, your reply must be a real analysis of that specific image
  (trend, pattern, levels) — never a generic non-answer.
- If the question is ambiguous (no coin, no image, no clear ask), ask ONE short
  clarifying question instead of guessing broadly.
- Keep responses concise and readable — short paragraphs or bullets, real terminology,
  no filler intros, no restating the question, no drifting into unrelated coins.
- Do not add a generic "not financial advice" disclaimer line — omit it entirely.

{promo_instructions}

## Language
Reply in {lang}. If the user writes Armenian in Latin letters, still reply in Armenian
script (հայատառ)."""

NO_PROMO_INSTRUCTION = (
    "## Promotions\n"
    "Do not mention the Futures Calculator Mini App or any Telegram channel in this "
    "reply — only bring them up if the user directly asks about tools or where to "
    "follow market news."
)

MINI_APP_PROMO_INSTRUCTION = (
    "## Promotion for this reply only\n"
    "Somewhere natural in this reply (not forced, not as a separate bolted-on line), "
    f"briefly mention the Futures Calculator Mini App ({MINI_APP_LINK}) as a genuinely "
    "useful tool for tracking the market, running position/liquidation/risk-reward "
    "calculations, managing risk, and getting trade signals. One short mention only, "
    "phrased differently than you've phrased it before — don't turn it into an ad."
)

CHANNEL_PROMO_INSTRUCTION = (
    "## Promotion for this reply only\n"
    f"Somewhere natural in this reply, briefly mention the Telegram channel ({CHANNEL_LINK}) "
    "as a very useful place for traders to catch market-moving crypto news the moment "
    "it's published. One short, natural mention only — don't turn it into an ad."
)

COIN_ALIASES = {
    "btc": "BTCUSDT", "bitcoin": "BTCUSDT", "բիթքոին": "BTCUSDT", "բիտքոին": "BTCUSDT",
    "eth": "ETHUSDT", "ethereum": "ETHUSDT", "եթեր": "ETHUSDT", "եթերիում": "ETHUSDT",
    "sol": "SOLUSDT", "solana": "SOLUSDT",
    "bnb": "BNBUSDT",
    "xrp": "XRPUSDT", "ripple": "XRPUSDT",
    "ada": "ADAUSDT", "cardano": "ADAUSDT",
    "doge": "DOGEUSDT", "dogecoin": "DOGEUSDT",
    "avax": "AVAXUSDT", "avalanche": "AVAXUSDT",
    "ton": "TONUSDT", "toncoin": "TONUSDT",
    "link": "LINKUSDT", "chainlink": "LINKUSDT",
}

IMAGE_ERROR_TEXT = {
    "hy": "Ներողություն, այս պահին չեմ կարողանում վերլուծել կցված նկարը (գուցե ֆորմատի կամ չափի խնդիր է)։ Փորձեք այլ նկար, կամ նկարագրեք այն տեքստով։",
    "ru": "Извините, сейчас не получается проанализировать прикреплённое изображение. Попробуйте другое изображение или опишите его текстом.",
    "en": "Sorry, I can't analyze the attached image right now. Try another image, or describe it in text.",
}


def detect_symbols(text: str) -> list[str]:
    if not text:
        return []
    lowered = text.lower()
    found = []
    for alias, symbol in COIN_ALIASES.items():
        if re.search(rf"(?<![a-zա-ֆ0-9]){re.escape(alias)}(?![a-zա-ֆ0-9])", lowered):
            if symbol not in found:
                found.append(symbol)
    return found[:3]  # cap to keep latency down


def fmt_price(p: float) -> str:
    return f"{p:,.6f}" if p < 1 else f"{p:,.2f}"


def fetch_live_prices(symbols: list[str]) -> list[str]:
    lines = []
    for sym in symbols:
        try:
            r = requests.get(
                "https://api.binance.com/api/v3/ticker/24hr",
                params={"symbol": sym},
                timeout=4,
            )
            if r.status_code == 200:
                d = r.json()
                price = float(d["lastPrice"])
                change = float(d["priceChangePercent"])
                sign = "+" if change >= 0 else ""
                lines.append(f"{sym.replace('USDT', '')}: ${fmt_price(price)} ({sign}{change:.2f}% / 24h)")
        except (requests.RequestException, KeyError, ValueError):
            continue
    return lines


def upload_image_asset(image_bytes: bytes, content_type: str, api_key: str) -> str:
    """Upload an oversized image to NVCF and return its asset_id."""
    resp = requests.post(
        NVCF_ASSETS_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "accept": "application/json",
        },
        json={"contentType": content_type, "description": "chat-crypto-chart"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    upload_url = data["uploadUrl"]
    asset_id = data["assetId"]

    put_resp = requests.put(
        upload_url,
        data=image_bytes,
        headers={
            "x-amz-meta-nvcf-asset-description": "chat-crypto-chart",
            "content-type": content_type,
        },
        timeout=60,
    )
    put_resp.raise_for_status()
    return asset_id


def build_promo_instructions(history: list) -> str:
    """
    Decide whether this reply should naturally mention the Mini App or the
    Telegram channel, based on how many assistant turns have already happened
    in this conversation. Keeps promotion occasional and non-repetitive
    instead of hardcoding it into every single reply.
    """
    prior_assistant_turns = sum(1 for m in (history or []) if m.get("role") == "assistant")
    current_turn = prior_assistant_turns + 1  # the reply we're about to generate

    if current_turn % MINI_APP_EVERY_N_TURNS == 0:
        return MINI_APP_PROMO_INSTRUCTION
    if current_turn % CHANNEL_EVERY_N_TURNS == 0:
        return CHANNEL_PROMO_INSTRUCTION
    return NO_PROMO_INSTRUCTION


def build_messages(message: str, lang: str, history: list, image: str | None):
    all_text = message + " " + " ".join(m.get("text", "") for m in (history or [])[-2:])
    symbols = detect_symbols(all_text)
    price_lines = fetch_live_prices(symbols) if symbols else []

    promo_instructions = build_promo_instructions(history)
    system_content = SYSTEM_PROMPT_TEMPLATE.format(lang=lang, promo_instructions=promo_instructions)
    if price_lines:
        system_content += "\n\nVerified live market data (source: Binance, fetched just now):\n" + "\n".join(price_lines)

    messages = [{"role": "system", "content": system_content}]

    for msg in (history or [])[-6:]:
        role = "user" if msg.get("role") == "user" else "assistant"
        text = msg.get("text")
        if text:
            messages.append({"role": role, "content": text})

    return messages


class handler(BaseHTTPRequestHandler):

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        # Preflight request the browser sends before the actual cross-origin POST.
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json(405, {"error": "Method not allowed"})

    def do_POST(self):
        api_key = os.environ.get("NVIDIA_API_KEY")
        if not api_key:
            self._json(500, {"error": "NVIDIA_API_KEY is not configured on Vercel"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"error": "Invalid JSON body"})
            return

        message = (body.get("message") or "").strip()
        lang = body.get("language") or "hy"
        image = body.get("image")
        has_image = isinstance(image, str) and ";base64," in image

        messages = build_messages(message, lang, body.get("history"), image)
        extra_headers = {}

        if has_image:
            header, b64data = image.split(";base64,", 1)
            content_type = header.replace("data:", "") or "image/jpeg"

            if len(b64data) <= INLINE_B64_LIMIT:
                user_content = [
                    {"type": "image_url", "image_url": {"url": image}},
                    {"type": "text", "text": message or "Analyze this chart/image"},
                ]
            else:
                try:
                    image_bytes = base64.b64decode(b64data)
                    asset_id = upload_image_asset(image_bytes, content_type, api_key)
                except (requests.RequestException, KeyError, ValueError):
                    self._json(200, {"reply": IMAGE_ERROR_TEXT.get(lang, IMAGE_ERROR_TEXT["en"])})
                    return
                user_content = f'<img src="data:{content_type};asset_id,{asset_id}" /> {message or "Analyze this chart/image"}'
                extra_headers["NVCF-INPUT-ASSET-REFERENCES"] = asset_id
        else:
            user_content = message or "Hello"

        messages.append({"role": "user", "content": user_content})

        stream = not has_image
        payload = {
            "model": MODEL,
            "messages": messages,
            "frequency_penalty": 0,
            "presence_penalty": 0,
            "temperature": 0.4,
            "top_p": 0.7,
            "max_tokens": 700 if has_image else 550,
            "stream": stream,
        }

        try:
            upstream = requests.post(
                NVIDIA_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "text/event-stream" if stream else "application/json",
                    "Content-Type": "application/json",
                    **extra_headers,
                },
                json=payload,
                stream=stream,
                timeout=60,
            )
        except requests.RequestException as exc:
            self._json(502, {"error": f"Could not reach NVIDIA NIM: {exc}"})
            return

        if upstream.status_code != 200:
            if has_image:
                self._json(200, {"reply": IMAGE_ERROR_TEXT.get(lang, IMAGE_ERROR_TEXT["en"])})
            else:
                self._json(upstream.status_code, {"error": f"NVIDIA NIM API error: {upstream.text}"})
            return

        if not stream:
            reply = upstream.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            self._json(200, {"reply": reply})
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self._cors_headers()
        self.end_headers()
        try:
            for line in upstream.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break
                try:
                    token = json.loads(data_str)["choices"][0]["delta"].get("content", "")
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue
                if token:
                    self.wfile.write(f"data: {json.dumps({'token': token})}\n\n".encode("utf-8"))
                    self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except BrokenPipeError:
            pass
        finally:
            upstream.close()
