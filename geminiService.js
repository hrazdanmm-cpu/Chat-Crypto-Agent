'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Փոխված է gemini-2.5-flash կամ gemini-1.5-flash-latest
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function generateReply({ message, history = [], marketContext = '', imageBase64 }) {
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

  const userParts = [{ text: promptText }];

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
