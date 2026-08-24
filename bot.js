// ============================================================================
//  Chat Crypto — Telegram Bot (@Chat_Crypto_Agent_Bot)
//  Բացում է Mini App-ը (WebApp կոճակով) և ուղարկում է հիմնական հրամանները
//
//  Այս ֆայլը կարող է աշխատել 2 ձևով.
//   1) Ինքնուրույն պրոցես.  node bot.js
//   2) server.js-ի ներսում (նույն process-ում, single-service deploy-ի համար).
//      server.js-ը startup-ի ժամանակ ինքն է կանչում require('./bot').startBot()
// ============================================================================
'use strict';

const { Telegraf, Markup } = require('telegraf');

function startBot() {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const MINI_APP_URL = process.env.MINI_APP_URL; // օր. https://your-app.fly.dev

  if (!BOT_TOKEN || !MINI_APP_URL) {
    console.warn(
      '⚠️  Telegram bot-ը չգործարկվեց. TELEGRAM_BOT_TOKEN և/կամ MINI_APP_URL կարգավորված չեն .env-ում։'
    );
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // -------------------------------------------------------------------------
  // /start — ողջույնի հաղորդագրություն + Mini App բացող կոճակ
  // -------------------------------------------------------------------------
  bot.start((ctx) => {
    ctx.reply(
      `Բարև, ${ctx.from.first_name || ''} 👋\n\n` +
        `Ես *Chat Crypto*-ի AI ագենտն եմ։ Կարող եմ վերլուծել կրիպտոարժույթներ, հաշվել ռիսկեր, ` +
        `համեմատել coin-ներ և ցույց տալ շուկայի ընդհանուր պատկերը՝ Binance-ի իրական տվյալների հիման վրա։\n\n` +
        `Սեղմիր ներքևի կոճակը՝ բացելու ամբողջական chat-ը`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([Markup.button.webApp('🚀 Բացել Chat Crypto', MINI_APP_URL)])
          .resize()
          .oneTime(false),
      }
    );
  });

  // -------------------------------------------------------------------------
  // /app — ուղիղ Mini App բացող inline կոճակ
  // -------------------------------------------------------------------------
  bot.command('app', (ctx) => {
    ctx.reply(
      '👉 Սեղմիր՝ բացելու Chat Crypto-ն.',
      Markup.inlineKeyboard([Markup.button.webApp('🚀 Chat Crypto', MINI_APP_URL)])
    );
  });

  // -------------------------------------------------------------------------
  // /help
  // -------------------------------------------------------------------------
  bot.help((ctx) => {
    ctx.reply(
      '/start — բացել բոտը և Mini App կոճակը\n' +
        '/app — ուղիղ բացել Chat Crypto Mini App-ը\n\n' +
        'Ողջ վերլուծությունը, ռիսկերի հաշվարկը և զրույցը AI ագենտի հետ տեղի է ունենում Mini App-ի ներսում։'
    );
  });

  // -------------------------------------------------------------------------
  // Ցանկացած այլ գրված տեքստ → հրավիրել բացել Mini App-ը
  // -------------------------------------------------------------------------
  bot.on('text', (ctx) => {
    ctx.reply(
      'Ամբողջական AI զրույցի համար բացիր Chat Crypto Mini App-ը 👇',
      Markup.inlineKeyboard([Markup.button.webApp('🚀 Chat Crypto', MINI_APP_URL)])
    );
  });

  bot.catch((err, ctx) => {
    console.error(`Telegram bot error for ${ctx.updateType}:`, err);
  });

  bot
    .launch()
    .then(() => {
      console.log('✅ Chat Crypto Telegram bot-ը գործարկվեց (polling mode)');
      console.log('   Mini App URL:', MINI_APP_URL);
    })
    .catch((err) => {
      console.error('❌ Bot launch failed (ստուգիր TELEGRAM_BOT_TOKEN-ը և ցանցի հասանելիությունը):', err.message || err);
    });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

// Եթե ֆայլը գործարկվում է ուղիղ (`node bot.js`), անմիջապես կանչել startBot()
if (require.main === module) {
  startBot();
}

module.exports = { startBot };
