'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { generateReply, generateReplyStream } = require('./lib/geminiService');
const { buildMarketContext } = require('./lib/marketService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '12mb' })); // generous limit to allow base64 image uploads
app.use(express.static(path.join(__dirname, 'public')));

function parseHistory(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// POST /api/chat — non-streaming. Used by the frontend whenever an image is
// attached (images can't be sent over a GET/EventSource request).
// ---------------------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  try {
    const { message = '', history, imageBase64 } = req.body || {};
    const marketContext = await buildMarketContext(message).catch(() => '');
    const reply = await generateReply({
      message,
      history: parseHistory(history),
      marketContext,
      imageBase64,
    });
    res.json({ reply });
  } catch (err) {
    console.error('[/api/chat] error:', err);
    res.status(500).json({ error: 'Something went wrong generating a reply. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream — Server-Sent Events. Used for normal text-only messages so
// the frontend can render the reply as it's generated.
// ---------------------------------------------------------------------------
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
    if (!closed) {
      send('done', { full });
      res.end();
    }
  } catch (err) {
    console.error('[/api/stream] error:', err);
    if (!closed) {
      send('error', { error: 'Connection error. Please try again.' });
      res.end();
    }
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Chat Crypto backend listening on port ${PORT}`);
});
