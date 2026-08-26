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
    const systemPrompt = `You are a deep, focused crypto-market analysis assistant.

Identity rule (follow exactly, in ${targetLanguage}): if the user asks who/what you are, what you can do, or who made you, answer with substantially this content and nothing about the underlying model or provider: "Ես խորացված վերլուծական եմ կրիպտոարժույթների և քոիների ուղղությամբ, ինձ ստեղծել է Արթուրը՝ հատուկ շուկան վերլուծելու և գրաֆիկներ կարդալու համար:" (translate naturally into ${targetLanguage} if it isn't Armenian, keeping the same meaning: a deep crypto/coin analysis assistant, created by Arthur specifically to analyze the market and read charts). Never mention Zhipu, GLM, Z.ai, OpenAI, Anthropic, or any other underlying model/vendor name.

Target language for your reply: ${targetLanguage} (if the user writes Armenian in Latin script, still reply in Armenian script — հայատառ).

Response rules — follow all of them strictly:
1. Answer the user's actual question directly and specifically. Do not restate the question, do not pad with generic introductions ("Great question!", "As an AI..." etc.), and do not drift into unrelated coins, topics, or filler.
2. Be concise and structured: short paragraphs or bullet points, concrete numbers/levels/reasoning where relevant, no repetition.
3. Base your analysis only on information in the current message (including any attached chart/screenshot image) and the conversation history provided — never invent live prices, exact percentages, or news you don't actually have; speak in terms of trend, structure, and risk instead when you lack live data.
4. If the request is ambiguous (e.g. no coin specified), ask ONE short clarifying question instead of guessing broadly.
5. Stay strictly focused on crypto markets, technical/chart analysis, and trading risk. Do not add a "not financial advice" / educational-only disclaimer line — omit it entirely.`;

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
    const hasImage = !!(image && typeof image === 'string' && image.includes(';base64,'));
    if (hasImage) {
      userContent = [
        { type: 'text', text: message || 'Analyze this chart/image' },
        { type: 'image_url', image_url: { url: image } }
      ];
    }

    messages.push({ role: 'user', content: userContent });

    // Zhipu AI (GLM) — OpenAI-compatible /chat/completions endpoint, Coding Plan.
    //
    // Coding Plan endpoint : https://api.z.ai/api/coding/paas/v4/chat/completions
    // Models available on the Coding Plan (as of writing): glm-4.5, glm-4.5-air,
    // glm-4.5-flash, glm-4.5v, glm-4.6, glm-4.6v, glm-4.7.
    // If later switching to a normal (non-Coding-Plan) API key from
    // open.bigmodel.cn, use https://open.bigmodel.cn/api/paas/v4/chat/completions instead.
    //
    // SPEED: "thinking" is explicitly disabled below — GLM-4.5+ models otherwise run an
    // internal reasoning pass by default, which adds several seconds of latency before
    // any visible text streams out and tends to produce longer, more meandering answers.
    // We also now ALWAYS stream (text and image requests alike, see below), so the first
    // tokens reach the client as soon as the model starts generating instead of the
    // browser waiting for the entire reply to finish.
    //
    // IMAGE / CHART ANALYSIS: "glm-4.5-flash" is text-only, so image_url content is
    // rejected with a 500 by that model. "glm-4.5v" is the vision-capable model on the
    // same Coding Plan and understands the same OpenAI-style
    // {type:"image_url", image_url:{url: "data:image/...;base64,..."}} content block,
    // so we switch to it automatically whenever an image/chart screenshot is attached.
    const model = hasImage ? 'glm-4.5v' : 'glm-4.5-flash';
    const response = await fetch('https://api.z.ai/api/coding/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages,
        thinking: { type: 'disabled' }, // անջատում ենք reasoning-ը՝ արագության և կենտրոնացվածության համար
        temperature: 0.4,               // ցածր/չափավոր՝ կենտրոնացված, կանխատեսելի պատասխանների համար
        top_p: 0.85,
        max_tokens: hasImage ? 700 : 600, // մի փոքր ավելի կարճ տեքստային պատասխաններ՝ ավելի արագ ավարտվող stream-ի համար
        stream: true,                    // now streamed for BOTH text and image requests, for fast first-token latency
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      // For image requests specifically, don't surface a raw error / stack trace to the
      // user — reply with a friendly, localized note instead so the chat still feels usable.
      if (hasImage) {
        console.error('Zhipu AI vision error:', errText);
        const friendly =
          targetLanguage === 'hy'
            ? 'Ներողություն, այս պահին չեմ կարողանում վերլուծել կցված նկարը (գուցե ֆորմատի կամ չափի խնդիր է)։ Փորձեք այլ նկար, կամ նկարագրեք այն տեքստով։'
            : targetLanguage === 'ru'
            ? 'Извините, сейчас не получается проанализировать прикреплённое изображение (возможно, проблема с форматом или размером). Попробуйте другое изображение или опишите его текстом.'
            : "Sorry, I can't analyze the attached image right now (possibly a format or size issue). Try another image, or describe it in text.";
        return new Response(JSON.stringify({ reply: friendly }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Zhipu AI API error: ${errText}`);
    }

    // Both text and image (chart) requests are now streamed the same way, so the
    // client sees tokens arrive as soon as the model starts generating.
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
