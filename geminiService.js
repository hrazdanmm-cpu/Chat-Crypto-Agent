'use strict';

const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf8');

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
    model: 'gemini-1.5-flash',
    systemInstruction: SYSTEM_PROMPT,
  });
}

// Convert our simple {role: 'user'|'model', text} history into Gemini's chat format.
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

/**
 * Non-streaming reply — used for the image-attachment flow (POST /api/chat).
 */
async function generateReply({ message, history, marketContext, imageBase64 }) {
  const model = getModel();
  const chat = model.startChat({ history: formatHistory(history) });
  const result = await chat.sendMessage(buildUserParts(message, marketContext, imageBase64));
  return result.response.text();
}

/**
 * Streaming reply — used for GET /api/stream (SSE). Returns an async iterator
 * of text chunks; caller is responsible for writing SSE frames.
 */
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
