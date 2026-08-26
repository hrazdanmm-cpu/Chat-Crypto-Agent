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
    const apiKey = process.env.ZHIPU_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ZHIPU_API_KEY is not configured on Vercel' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const targetLanguage = language || 'hy';
    const systemPrompt = `You are Chat Crypto, an expert AI crypto analyst. Target Language for response: ${targetLanguage}. Important rules: 1. Provide concise, clear, and high-quality technical and market analysis for cryptocurrencies. 2. If the user talks in Armenian (even in Latin script), respond in Armenian script (հայատառ). 3. Always include a short disclaimer that this is educational content, not financial advice.`;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    if (Array.isArray(history)) {
      history.forEach((msg) => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.text,
        });
      });
    }

    let userContent = message;
    if (image && typeof image === 'string' && image.includes(';base64,')) {
      userContent = [
        { type: 'text', text: message || 'Analyze this image' },
        { type: 'image_url', image_url: { url: image } }
      ];
    }

    messages.push({ role: 'user', content: userContent });

    // Zhipu AI (GLM) — OpenAI-compatible /chat/completions endpoint.
    //
    // IMPORTANT: a key created under Z.ai's "Model & Personal Coding Plan" page is a
    // *Coding Plan* subscription key, not a normal pay-as-you-go API key. Coding Plan
    // keys only work against the dedicated Coding endpoint below — sending them to the
    // general endpoint (api.z.ai/api/paas/v4 or open.bigmodel.cn/api/paas/v4) returns
    // error 1211 ("模型不存在，请检查模型代码" / "model not found"), because the key
    // simply isn't recognized as valid there — it's not really a "wrong model name" bug.
    //
    // Coding Plan endpoint : https://api.z.ai/api/coding/paas/v4/chat/completions
    // Models available on the Coding Plan (as of writing): glm-4.5, glm-4.5-air,
    // glm-4.5-flash, glm-4.5v, glm-4.6, glm-4.6v, glm-4.7.
    // If you later switch to a normal (non-Coding-Plan) API key from
    // open.bigmodel.cn, use https://open.bigmodel.cn/api/paas/v4/chat/completions
    // and a model like "glm-4-flash-250414" or "glm-4.7-flash" instead.
    const response = await fetch('https://api.z.ai/api/coding/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4.5-flash', // Coding Plan-ում հասանելի, արագ մոդել
        messages: messages,
        temperature: 0.2,
        top_p: 0.7,
        max_tokens: 1024,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Zhipu AI API error: ${errText}`);
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                const dataStr = trimmed.replace('data: ', '');
                if (dataStr === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(dataStr);
                  const text = parsed.choices?.[0]?.delta?.content || '';
                  if (text) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: text })}\n\n`));
                  }
                } catch (e) {
                  // անտեսել անավարտ JSON-ները
                }
              }
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
