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
    const systemPrompt = `You are Chat Crypto, a focused AI crypto analyst.

Target language for your reply: ${targetLanguage} (if the user writes Armenian in Latin script, still reply in Armenian script — հայատառ).

Response rules — follow all of them strictly:
1. Answer the user's actual question directly and specifically. Do not restate the question, do not pad with generic introductions ("Great question!", "As an AI..." etc.), and do not drift into unrelated coins, topics, or disclaimers-heavy filler.
2. Be concise and structured: short paragraphs or bullet points, concrete numbers/levels/reasoning where relevant, no repetition.
3. Base your analysis only on information in the current message and the conversation history provided — never invent live prices, exact percentages, or news you don't actually have; speak in terms of trend, structure, and risk instead when you lack live data.
4. If the request is ambiguous (e.g. no coin specified), ask ONE short clarifying question instead of guessing broadly.
5. End with a single short line noting this is educational content, not financial advice — one line only, not a paragraph.`;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    if (Array.isArray(history)) {
      // Keep only the last few turns — long history both slows the request down
      // and gives the model more irrelevant context to get distracted by.
      history.slice(-6).forEach((msg) => {
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
    //
    // PERFORMANCE NOTE: GLM-4.5+ models run an internal "thinking" / reasoning pass
    // by default. That reasoning pass is what was causing both problems reported —
    // it adds several extra seconds of latency before any visible text streams out,
    // and for a short, direct Q&A chatbot like this one it tends to produce longer,
    // more meandering answers. Explicitly disabling it below fixes both: replies
    // start streaming almost immediately and stay on-topic.
    const response = await fetch('https://api.z.ai/api/coding/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4.5-flash', // Coding Plan-ում հասանելի, արագ մոդել
        messages: messages,
        thinking: { type: 'disabled' }, // անջատում ենք reasoning-ը՝ արագության և կենտրոնացվածության համար
        temperature: 0.4,               // ցածր/չափավոր՝ կենտրոնացված, կանխատեսելի պատասխանների համար
        top_p: 0.85,
        max_tokens: 700,                // բավարար մանրամասն, բայց ոչ ջրիկ պատասխանների համար
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
        let buffer = ''; // holds any incomplete line across chunk boundaries
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? ''; // last element may be an incomplete line — keep it for next read

            for (const raw of lines) {
              const trimmed = raw.trim();
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
