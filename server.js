'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Ստանում ենք API Key-ը Environment Variables-ից
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Օգտագործում ենք ակտիվ gemini-1.5-flash մոդելը
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

/**
 * Non-streaming reply (օգտագործվում է նկարների կամ սովորական POST request-ների համար)
 */
async function generateReply({ message, history = [], marketContext = '', imageBase64 }) {
  const contents = [];

  // Ավելացնում ենք պատմությունը (history)
  if (Array.isArray(history)) {
    history.forEach((item) => {
      if (item.role && item.parts) {
        contents.push(item);
      }
    });
  }

  // Կազմում ենք նոր հաղորդագրության տեքստը
  let promptText = message;
  if (marketContext) {
    promptText = `[Market Data Context:\n${marketContext}]\n\nUser Question: ${message}`;
  }

  const userParts = [{ text: promptText }];

  // Եթե առկա է base64 նկար
  if (imageBase64) {
    const mimeTypeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    userParts.push({
      inlineData: {
        data: cleanBase64,
        mimeType: mimeType,
      },
    });
  }

  contents.push({ role: 'user', parts: userParts });

  const result = await model.generateContent({ contents });
  const response = await result.response;
  return response.text();
}

/**
 * Streaming reply (օգտագործվում է /api/stream endpoint-ի համար)
 */
async *generateReplyStream({ message, history = [], marketContext = '' }) {
  const contents = [];

  if (Array.isArray(history)) {
    history.forEach((item) => {
      if (item.role && item.parts) {
        contents.push(item);
      }
    });
  }

  let promptText = message;
  if (marketContext) {
    promptText = `[Market Data Context:\n${marketContext}]\n\nUser Question: ${message}`;
  }

  contents.push({ role: 'user', parts: [{ text: promptText }] });

  const resultStream = await model.generateContentStream({ contents });

  for await (const chunk of resultStream.stream) {
    const chunkText = chunk.text();
    if (chunkText) {
      yield chunkText;
    }
  }
}

module.exports = {
  generateReply,
  generateReplyStream,
};
