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
    const apiKey = process.env.NVIDIA_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'NVIDIA_API_KEY is not configured on Vercel' }),
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

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct', // Աշխատող և հասանելի մոդել NVIDIA-ից
        messages: messages,
        temperature: 0.2,
        top_p: 0.7,
        max_tokens: 1024,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API error: ${errText}`);
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
