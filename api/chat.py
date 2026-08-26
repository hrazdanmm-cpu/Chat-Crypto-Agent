"""
Chat Crypto backend — NVIDIA NIM (meta/llama-3.2-90b-vision-instruct).

Deploys as a Vercel Python Function (file-based /api handler). Single model
handles both plain text questions and image/chart analysis, so there's no
model-switching logic and no "wrong model for images" failure mode.

Env var required on Vercel: NVIDIA_API_KEY  (build.nvidia.com -> model -> Get API Key)
"""

import json
import os
from http.server import BaseHTTPRequestHandler

import requests

NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
MODEL = "meta/llama-3.2-90b-vision-instruct"

SYSTEM_PROMPT_TEMPLATE = """You are a deep, focused crypto-market analysis assistant.

Identity rule (answer in {lang}): if asked who/what you are, what you can do, or who made
you, reply with substantially this content — a deep crypto/coin analysis assistant, created
by Arthur specifically to analyze the market and read charts — using this exact Armenian
wording as the base and translating it naturally into {lang} if {lang} isn't Armenian:
"Ես խորացված վերլուծական եմ կրիպտոարժույթների և քոիների ուղղությամբ, ինձ ստեղծել է
Արթուրը՝ հատուկ շուկան վերլուծելու և գրաֆիկներ կարդալու համար:"
Never mention Meta, Llama, NVIDIA, NIM, or any other underlying model/vendor name.

Reply language: {lang} (if the user writes Armenian in Latin letters, still reply in
Armenian script — հայատառ).

Rules:
1. Answer the actual question directly — no restating the question, no filler intros,
   no drifting into unrelated coins or topics.
2. Write like a professional market/technical analyst: trend & structure, key support &
   resistance, momentum/volume, and concrete risk (invalidation, volatility, position
   sizing) — short paragraphs or bullets, real TA terminology, not vague language.
3. Use only the current message (including any attached chart image) and the given
   history. Never invent live prices or news; reason in terms of trend/structure/risk
   when live data isn't available, and say so briefly.
4. If the request is ambiguous (no coin specified), ask ONE short clarifying question.
5. Stay strictly on crypto markets, futures, and technical/chart analysis. Never add a
   "not financial advice" / educational-only disclaimer — omit it entirely.
"""

IMAGE_ERROR_TEXT = {
    "hy": "Ներողություն, այս պահին չեմ կարողանում վերլուծել կցված նկարը (գուցե ֆորմատի կամ չափի խնդիր է)։ Փորձեք այլ նկար, կամ նկարագրեք այն տեքստով։",
    "ru": "Извините, сейчас не получается проанализировать прикреплённое изображение. Попробуйте другое изображение или опишите его текстом.",
    "en": "Sorry, I can't analyze the attached image right now. Try another image, or describe it in text.",
}


def build_messages(message: str, lang: str, history: list, image: str | None):
    messages = [{"role": "system", "content": SYSTEM_PROMPT_TEMPLATE.format(lang=lang)}]

    for msg in (history or [])[-6:]:  # short history = faster + more focused replies
        role = "user" if msg.get("role") == "user" else "assistant"
        text = msg.get("text")
        if text:
            messages.append({"role": role, "content": text})

    if image and ";base64," in image:
        content = [
            {"type": "image_url", "image_url": {"url": image}},
            {"type": "text", "text": message or "Analyze this chart/image"},
        ]
    else:
        content = message or "Hello"

    messages.append({"role": "user", "content": content})
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
        stream = not has_image  # keep image requests non-streamed: simplest, most reliable

        payload = {
            "model": MODEL,
            "messages": build_messages(message, lang, body.get("history"), image),
            "frequency_penalty": 0,
            "presence_penalty": 0,
            "temperature": 0.4,   # lower than the NVIDIA playground default (1) for
            "top_p": 0.7,         # faster, more focused, less rambling analyst replies
            "max_tokens": 700 if has_image else 550,
            "stream": stream,
        }

        try:
            upstream = requests.post(
                NVIDIA_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "text/event-stream" if stream else "application/json",
                    "Content-Type": "application/json",
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

        # Relay NVIDIA's SSE stream to the browser as {"token": "..."} chunks.
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
