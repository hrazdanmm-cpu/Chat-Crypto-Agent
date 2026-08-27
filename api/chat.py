"""
Chat Crypto backend — NVIDIA NIM (meta/llama-3.2-11b-vision-instruct).

Deploys as a Vercel Python Function (file-based /api handler).

Env var required on Vercel: NVIDIA_API_KEY  (build.nvidia.com -> model -> Get API Key)

  IMPORTANT: Set NVIDIA_API_KEY in Vercel Project Settings -> Environment Variables.
  Never hardcode the key in this file — if this file is ever pushed to a public repo
  or shared, a hardcoded key gets scraped and abused within minutes. Environment
  variables keep the key off of disk/git entirely and let you rotate it without
  touching code.

Model: meta/llama-3.2-11b-vision-instruct — smaller/faster vision model than the 90B
variant, chosen for lower latency on both text and image requests while still
supporting multimodal (image + text) input.

Fixes carried over from the previous version:
  1. Images over NVIDIA's ~180,000-char inline base64 limit are uploaded via the
     NVCF Assets API and referenced by asset_id instead of being silently rejected/
     mishandled — this is what caused "doesn't read the image" for normal-sized
     phone screenshots (which are almost always well over 180KB).
  2. The "who are you" identity line is strictly gated: the model is instructed to
     use it ONLY for literal identity questions, and explicitly told never to use it
     as a fallback for images, price questions, or anything else it's unsure about.
  3. Live prices: when the user's message mentions a recognized coin, we fetch the
     current price/24h change from Binance's public API and hand it to the model as
     verified data, so price questions get real numbers instead of "I don't know".
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

SYSTEM_PROMPT_TEMPLATE = """You are a deep, focused crypto-market analysis assistant.

Identity rule — apply ONLY when the user's entire message is a literal question about
who/what you are, what you can do, or who made you (e.g. "ov es du", "inch bot es",
"what can you do"). In that case, reply in {lang} with substantially this content — a
deep crypto/coin analysis assistant, created by Arthur specifically to analyze the
market and read charts — using this Armenian wording as the base, translated naturally
into {lang} if {lang} isn't Armenian:
"Ես խորացված վերլուծական եմ կրիպտոարժույթների և քոիների ուղղությամբ, ինձ ստեղծել է
Արթուրը՝ հատուկ շուկան վերլուծելու և գրաֆիկներ կարդալու համար:"
For EVERY other message — including image/chart analysis, price questions, greetings,
or anything you're unsure about — do NOT use this sentence or anything resembling it.
Never mention Meta, Llama, NVIDIA, NIM, or any other underlying model/vendor name.

Reply language: {lang} (if the user writes Armenian in Latin letters, still reply in
Armenian script — հայատառ).

Rules:
1. If an image is attached, your entire reply must be a real analysis of that specific
   image — describe what the chart/screenshot actually shows (trend, pattern, levels),
   never a generic or templated non-answer.
2. Otherwise, answer the actual question directly — no restating the question, no
   filler intros, no drifting into unrelated coins or topics.
3. Write like a professional market/technical analyst: trend & structure, key support &
   resistance, momentum/volume, and concrete risk (invalidation, volatility, position
   sizing) — short paragraphs or bullets, real TA terminology, not vague language.
4. If a "Verified live market data" block is provided below, treat those numbers as
   accurate and use them directly when relevant. Otherwise never invent live prices or
   news — reason in terms of trend/structure/risk instead, and say so briefly.
5. If the request is ambiguous (no coin specified, no image, no clear question), ask
   ONE short clarifying question instead of guessing broadly.
6. Stay strictly on crypto markets, futures, and technical/chart analysis. Never add a
   "not financial advice" / educational-only disclaimer — omit it entirely.
"""

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


def build_messages(message: str, lang: str, history: list, image: str | None):
    # Live price context (checked against the current message + last user turn).
    all_text = message + " " + " ".join(m.get("text", "") for m in (history or [])[-2:])
    symbols = detect_symbols(all_text)
    price_lines = fetch_live_prices(symbols) if symbols else []

    system_content = SYSTEM_PROMPT_TEMPLATE.format(lang=lang)
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
    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
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
                # Small enough to send inline, as a typed content block.
                user_content = [
                    {"type": "image_url", "image_url": {"url": image}},
                    {"type": "text", "text": message or "Analyze this chart/image"},
                ]
            else:
                # Over NVIDIA's inline limit: upload to NVCF assets and reference by id.
                try:
                    image_bytes = base64.b64decode(b64data)
                    asset_id = upload_image_asset(image_bytes, content_type, api_key)
                except (requests.RequestException, KeyError, ValueError):
                    self._json(200, {"reply": IMAGE_ERROR_TEXT.get(lang, IMAGE_ERROR_TEXT["en"])})
                    return
                # Per NVIDIA's asset format, the message content must be a plain string
                # with an <img> tag referencing the asset, and the id must also be
                # echoed in the NVCF-INPUT-ASSET-REFERENCES header.
                user_content = f'<img src="data:{content_type};asset_id,{asset_id}" /> {message or "Analyze this chart/image"}'
                extra_headers["NVCF-INPUT-ASSET-REFERENCES"] = asset_id
        else:
            user_content = message or "Hello"

        messages.append({"role": "user", "content": user_content})

        stream = not has_image  # keep image requests non-streamed: simplest, most reliable
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
