import { GoogleGenerativeAI } from '@google/generative-ai';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { message, language, history, image } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY is not configured on Vercel' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Օգտագործում ենք gemini-1.5-flash մոդելը՝ արագ և էժան/անվճար աշխատանքի համար
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const systemPrompt = `You are Chat Crypto, an expert AI crypto analyst. Target Language for response: ${language || 'hy'}. Important rules: 1. Provide concise, clear, and high-quality technical and market analysis for cryptocurrencies. 2. If the user talks in Armenian (even in Latin script), respond in Armenian script (հայատառ). 3. Always include a short disclaimer that this is educational content, not financial advice.`;
    
    const contents = [];
    
    // System instruction mapping
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow all instructions and perform as Chat Crypto.' }] });

    // History mapping
    if (Array.isArray(history)) {
      history.forEach((msg) => {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }],
        });
      });
    }

    // Current Prompt with Image support
    const currentParts = [{ text: message }];
    if (image && typeof image === 'string' && image.includes(';base64,')) {
      const match = image.match(/^data:(image\/[a-zA-Z\+]+);base64,(.+)$/);
      if (match) {
        currentParts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }

    contents.push({ role: 'user', parts: currentParts });

    // Model generation call
    const result = await model.generateContent({ contents });
    const responseText = result.response.text();

    return new Response(JSON.stringify({ reply: responseText }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
