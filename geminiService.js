'use strict';

const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function loadSystemPrompt() {
  const candidates = [
    path.join(__dirname, 'system_prompt.txt'),                 // same folder as this file (root)
    path.join(__dirname, '..', 'system_prompt.txt'),
    path.join(process.cwd(), 'system_prompt.txt'),
    path.join(process.cwd(), 'src', 'system_prompt.txt'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    } catch (e) { /* keep trying */ }
  }
  console.error(
    'system_prompt.txt not found. Looked in:\n' + candidates.map((p) => '  - ' + p).join('\n') +
    '\nMake sure system_prompt.txt is committed to your repo alongside server.js.'
  );
  return 'You are Chat Crypto, a crypto market analyst assistant created by Artur. Reply in the same language the user writes in. Focus strictly on crypto/finance topics. Always include a brief "not financial advice" disclaimer for analysis-style answers.';
}

const SYSTEM_PROMPT = loadSystemPrompt();

let genAI = null;
function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

function getModel() {
  return getClient().getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
  });
}

function formatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && m.text)
    .map((m) => ({
      role: m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));
}

function buildUserParts(message, marketContext, imageBase64) {
  const parts = [];
  if (imageBase64) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageBase64);
    if (match) {
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }
  const textPieces = [];
  if (marketContext) textPieces.push(marketContext);
  textPieces.push(message || (imageBase64 ? 'Please analyze this image.' : ''));
  parts.push({ text: textPieces.join('\n\n') });
  return parts;
}

async function generateReply({ message, history, marketContext, imageBase64 }) {
  const model = getModel();
  const chat = model.startChat({ history: formatHistory(history) });
  const result = await chat.sendMessage(buildUserParts(message, marketContext, imageBase64));
  return result.response.text();
}

async function* generateReplyStream({ message, history, marketContext }) {
  const model = getModel();
  const chat = model.startChat({ history: formatHistory(history) });
  const result = await chat.sendMessageStream(buildUserParts(message, marketContext, null));
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

module.exports = { generateReply, generateReplyStream };