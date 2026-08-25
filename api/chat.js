<!doctype html>
<html lang="hy">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#080b14" />
  <title>Chat Crypto</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config={theme:{extend:{colors:{base:'#080b14',panel:'#111827',panel2:'#182238',line:'#26324b',brand:'#7c83ff',mint:'#34d399'},fontFamily:{sans:['Inter','system-ui','Noto Sans Armenian','sans-serif']}}}}</script>
  <style>
    :root{--safe-bottom:env(safe-area-inset-bottom,0px)}*{-webkit-tap-highlight-color:transparent}html,body{height:100%;background:#080b14}body{overflow:hidden}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#34405a;border-radius:9px}.no-scrollbar::-webkit-scrollbar{display:none}
    @keyframes ring{to{transform:rotate(360deg)}}@keyframes hue{50%{filter:hue-rotate(50deg)}}@keyframes up{from{opacity:0;transform:translateY(8px)}}@keyframes pulse{50%{opacity:.45;transform:translateY(-3px)}}
    .logo{position:relative;display:grid;place-items:center;border-radius:999px;isolation:isolate;background:#0d1426}.logo:before{content:"";position:absolute;inset:-4px;border-radius:inherit;background:conic-gradient(#35d39e,#5698ff,#9664ff,#ff7eb6,#ffc658,#35d39e);animation:ring 16s linear infinite,hue 10s linear infinite;z-index:-1}.logo:after{content:"";position:absolute;inset:-1px;border-radius:inherit;border:2px solid #0a1020;z-index:-1}.logo-image{width:100%;height:100%;object-fit:cover;object-position:center 42%;border-radius:inherit;display:block}.message{animation:up .2s ease-out}.bot-bubble{border-radius:5px 18px 18px 18px}.user-bubble{border-radius:18px 5px 18px 18px}.typing i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#aeb8d0;margin:0 2px;animation:pulse 1s infinite}.typing i:nth-child(2){animation-delay:.13s}.typing i:nth-child(3){animation-delay:.26s}
  </style>
</head>
<body class="bg-base text-slate-100 antialiased">
  <div id="app" class="h-[100dvh] flex overflow-hidden">
    <aside id="sidebar" class="hidden md:flex w-72 shrink-0 flex-col border-r border-line bg-[#0c1222] p-3">
      <div class="flex items-center gap-3 px-2 py-3"><div class="logo h-9 w-9"><img class="logo-image" src="assets/chat-crypto-logo.png" alt="Chat Crypto logo"></div><div><strong>Chat Crypto</strong><p class="text-xs text-slate-400">AI Crypto Analyst</p></div></div>
      <button id="newChatSide" class="mt-3 rounded-xl bg-brand px-4 py-3 text-left text-sm font-semibold transition hover:brightness-110">＋ <span data-t="newChat">Նոր զրույց</span></button>
      <a id="futuresMenu" href="https://t.me/Block_News_Crypto_bot" class="mt-2 rounded-xl border border-mint/40 bg-mint/10 px-4 py-3 text-mint hover:bg-mint/20" target="_blank" rel="noopener"><span class="block text-sm font-semibold">🧮 Futures Calculator Mini App</span><span class="mt-0.5 block text-[11px] text-slate-400">Open in Telegram →</span></a>
      <div class="mt-3 grid gap-1"><button class="tool rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-panel" data-tool="analysis">📊 <span data-label="analysis">Վերլուծություն</span></button><button class="tool rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-panel" data-tool="risk">⚠️ <span data-label="risk">Ռիսկեր</span></button><button class="tool rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-panel" data-tool="gainers">🚀 <span data-label="gainers">Top Gainers</span></button></div>
      <label class="mt-4 flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-slate-400"><span>⌕</span><input id="searchChats" class="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500" data-p="search" placeholder="Որոնել զրույցներում" /></label>
      <p class="mt-5 px-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500" data-t="recent">Վերջին զրույցներ</p><div id="history" class="mt-2 flex-1 space-y-1 overflow-y-auto"></div>
      <p class="border-t border-line px-2 pt-3 text-[11px] leading-4 text-slate-500" data-t="disclaimer">Կրթական տեղեկություն, ոչ ֆինանսական խորհուրդ։</p>
    </aside>
    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-16 shrink-0 items-center justify-between border-b border-line bg-base/90 px-3 backdrop-blur md:px-5">
        <div class="flex items-center gap-3"><button id="menu" class="rounded-lg p-2 hover:bg-panel md:hidden" aria-label="Menu">☰</button><div class="logo h-8 w-8 md:hidden"><img class="logo-image" src="assets/chat-crypto-logo.png" alt="Chat Crypto logo"></div><div><h1 class="font-semibold">Chat Crypto</h1><p class="text-xs text-slate-400"><span class="text-mint">●</span> <span data-t="online">Առցանց է</span></p></div></div>
        <div class="relative flex items-center gap-1"><button id="voiceToggle" class="rounded-lg p-2 text-slate-300 hover:bg-panel" aria-label="Text to speech" title="Voice responses">🔊</button><button id="moreBtn" class="rounded-lg p-2 text-slate-300 hover:bg-panel" aria-label="More menu">⋮</button><div id="moreMenu" class="absolute right-0 top-11 z-20 hidden w-64 rounded-xl border border-line bg-panel p-2 shadow-2xl"><a href="https://t.me/Block_News_Crypto_bot" target="_blank" rel="noopener" class="block rounded-lg px-3 py-2 text-sm text-mint hover:bg-panel2">🧮 Futures Calculator Mini App<span class="mt-1 block text-[11px] text-slate-400">Open in Telegram →</span></a></div><select id="uiLanguage" class="rounded-lg border border-line bg-panel px-2 py-1.5 text-sm outline-none"><option value="en">English</option><option value="ru">Русский</option><option value="hy">Հայերեն</option><option value="tr">Türkçe</option></select></div>
      </header>
      <main id="scrollArea" class="no-scrollbar flex-1 overflow-y-auto"><div id="chat" class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 py-7 md:px-7">
        <section id="welcome" class="m-auto text-center"><div class="logo mx-auto mb-7 h-16 w-16 max-w-[26vw] max-h-[26vw]"><img class="logo-image" src="assets/chat-crypto-logo.png" alt="Chat Crypto logo"></div><h2 class="text-3xl font-bold tracking-tight" data-t="welcomeTitle">Ձեր AI կրիպտո-վերլուծաբանը</h2><p class="mx-auto mt-3 max-w-xl leading-6 text-slate-400" data-t="welcomeText">Հարցրե՛ք կրիպտոների մասին։</p></section>
      </div></main>
      <footer class="border-t border-line bg-base/95 px-3 pt-2 backdrop-blur md:px-6"><div class="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line bg-panel px-2 py-2 focus-within:border-brand"><textarea id="input" rows="1" maxlength="4000" class="no-scrollbar max-h-32 min-h-[34px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-5 outline-none placeholder:text-slate-500" placeholder="Հարցրեք կրիպտոյի մասին…"></textarea><button id="send" class="grid h-9 w-9 place-items-center rounded-xl bg-brand text-lg font-bold transition hover:brightness-110">↑</button></div></footer>
    </section>
  </div>
<script>
(() => {
  'use strict';
  const API_CHAT='/api/chat', API_COINS='/api/coins';
  const $=s=>document.querySelector(s),chat=$('#chat'),input=$('#input'),welcome=$('#welcome');let messages=[];
  function bubble(role,text){const row=document.createElement('article');row.className='message flex gap-2 '+(role==='user'?'ml-auto flex-row-reverse':'mr-auto');const b=document.createElement('div');b.className=(role==='user'?'user-bubble bg-[#28366d]':'bot-bubble bg-panel')+' max-w-[calc(100%-42px)] whitespace-pre-wrap px-3.5 py-2.5 text-[14px] leading-6';b.textContent=text;row.append(b);chat.append(row);row.scrollIntoView({block:'end'});return b}
  async function send(){const text=input.value.trim();if(!text)return;welcome.hidden=true;bubble('user',text);messages.push({role:'user',text});input.value='';const holder=bubble('bot','...');try{const r=await fetch(API_CHAT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,language:'hy',history:messages})});const d=await r.json();holder.textContent=d.reply||d.text||'Պատասխան չստացվեց';messages.push({role:'assistant',text:holder.textContent})}catch(e){holder.textContent='Սերվերի սխալ';}}
  $('#send').onclick=send;
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};
})();
</script>
</body>
</html>
