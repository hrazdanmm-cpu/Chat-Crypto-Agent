'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { generateReply, generateReplyStream } = require('./geminiService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '12mb' }));

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
    const { message = '', history, imageBase64, marketContext = '' } = req.body || {};
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

app.get('/api/stream', async (req, res) => {
  const message = typeof req.query.message === 'string' ? req.query.message : '';
  const history = parseHistory(req.query.history);
  const marketContext = typeof req.query.marketContext === 'string' ? req.query.marketContext : '';

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
    let full = '';
    await generateReplyStream({ message, history, marketContext }, (chunk) => {
      if (!closed) {
        full += chunk;
        send('delta', { text: chunk });
      }
    });

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