// Renders the Chrome Web Store images from the real extension UI:
//   screenshot-1…5 (1280×800), promo-small (440×280), promo-marquee (1400×560)
//
// It loads the extension into a throwaway headless Chrome profile, adds demo
// rules and tabs, captures the rules page and the popup, and composes the
// images. Headless Chrome has no visible tab strip, so the tab strip is drawn
// from the groups the extension actually created in the demo window.
//
// Usage: node scripts/store-assets.mjs [outDir]   (default: store/)
// Set CHROME=/path/to/chrome if Chrome isn't in the default macOS location.

import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { TEMPLATES, createRule } from '../src/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'store'));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ICON = pathToFileURL(path.join(ROOT, 'icons/icon128.png')).href;

// ---- Demo content -----------------------------------------------------------

const DEMO_RULES = [
  { ...TEMPLATES.localhost, color: 'green', position: 1 },
  { ...TEMPLATES.lan, color: 'cyan' },
  { label: 'GitHub repos', pattern: '^https://github\\.com/[^/]+/([^/]+)', title: '📦 $1', color: 'purple', minTabs: 1 },
  TEMPLATES.domain,
  { ...TEMPLATES.chrome, color: 'grey' },
  { ...TEMPLATES.newtab, color: 'blue' },
].map((fields) => createRule(fields));

// url → title and favicon used when drawing the tab strip
const DEMO_TABS = [
  ['https://en.wikipedia.org/wiki/Regular_expression', 'Regular expression – Wikipedia', 'W', '#54595d'],
  ['http://localhost:3000/', 'Dashboard – localhost:3000', 'D', '#2563eb'],
  ['http://192.168.1.1/', 'Router admin', 'R', '#0e7490'],
  ['https://en.wikipedia.org/wiki/Tab_(interface)', 'Tab (interface) – Wikipedia', 'W', '#54595d'],
  ['https://github.com/codejo-dev/TabGrouplet/issues', 'Issues · codejo-dev/TabGrouplet', 'G', '#24292f'],
  ['chrome://extensions/', 'Extensions', '⚙', '#5f6368'],
];
// What each demo group shows off, for the legend under the tab strip.
const LEGEND = {
  '💻': ['Localhost', 'Any port · placed first'],
  '🛜': ['LAN', '192.168.*, 10.*, 172.16–31.*'],
  '📦 TabGrouplet': ['GitHub repos', 'Named from the URL: 📦 $1'],
  wikipedia: ['By domain name', 'Subdomains dropped · from 2 tabs'],
  '⚙️': ['Chrome pages', 'chrome:// pages · placed last'],
};
const ACTIVE_URL = 'https://github.com/codejo-dev/TabGrouplet/issues';
const TAB_INFO = new Map(DEMO_TABS.map(([url, title, letter, color]) => [url, { title, letter, color }]));

// Chrome's tab group colors (light theme), as in src/theme.css
const COLORS = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#fa7b17',
};

// ---- Chrome over the DevTools protocol ----------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const work = mkdtempSync(path.join(tmpdir(), 'tab-grouplet-store-'));
const raw = (name) => path.join(work, name);

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--user-data-dir=${path.join(work, 'profile')}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--host-resolver-rules=MAP * ~NOTFOUND', // demo URLs never hit the network
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);

let nextId = 0;
const pending = new Map();
let buffer = '';
chrome.stdio[4].setEncoding('utf8');
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf('\0')) >= 0; ) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const call = pending.get(message.id);
    if (!call) continue;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
    else call.resolve(message.result);
  }
});

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method}: no answer from Chrome within 30s`));
    }, 30000);
    pending.set(id, {
      method,
      resolve: (value) => (clearTimeout(timer), resolve(value)),
      reject: (err) => (clearTimeout(timer), reject(err)),
    });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}

async function evaluate(sessionId, body) {
  const result = await send(
    'Runtime.evaluate',
    { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function attachWorker(extensionId) {
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const worker = targetInfos.find(
      (t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extensionId}/`),
    );
    if (worker) return (await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true })).sessionId;
    await sleep(100);
  }
  throw new Error('extension service worker not found');
}

async function waitReady(sessionId) {
  for (let i = 0; i < 100; i++) {
    if ((await evaluate(sessionId, 'return document.readyState').catch(() => '')) === 'complete') break;
    await sleep(100);
  }
  await evaluate(
    sessionId,
    `await document.fonts.ready;
     await Promise.all([...document.images].map((i) => i.complete || new Promise((done) => { i.onload = i.onerror = done; })));`,
  );
  await sleep(300);
}

async function openPage(url, { width, height, scale = 2 }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await setViewport(sessionId, width, height, scale);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await waitReady(sessionId);
  return { sessionId, targetId };
}

function setViewport(sessionId, width, height, scale) {
  return send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
}

// Page coordinates of the union of the elements matched by the selectors.
function areaOf(sessionId, selectors, pad = 0) {
  return evaluate(
    sessionId,
    `const rects = ${JSON.stringify(selectors)}.map((s) => document.querySelector(s).getBoundingClientRect());
     const top = Math.min(...rects.map((r) => r.top)) - ${pad}, bottom = Math.max(...rects.map((r) => r.bottom)) + ${pad};
     const left = Math.min(...rects.map((r) => r.left)) - ${pad}, right = Math.max(...rects.map((r) => r.right)) + ${pad};
     return { x: left + scrollX, y: top + scrollY, width: right - left, height: bottom - top };`,
  );
}

async function capture(sessionId, file, clip) {
  const params = { format: 'png', captureBeyondViewport: true };
  if (clip) params.clip = { ...clip, scale: 1 };
  const { data } = await send('Page.captureScreenshot', params, sessionId);
  writeFileSync(file, Buffer.from(data, 'base64'));
}

// ---- Composition ----------------------------------------------------------------

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const img = (file, className = 'shot') => `<img class="${className}" src="${pathToFileURL(file).href}" alt="">`;

const WINDOW_CSS = `
  .win { position: relative; overflow: hidden; border-radius: 12px; background: #fff; border: 1px solid #cfd5dd;
         box-shadow: 0 1px 2px rgba(16,24,40,.06), 0 24px 60px rgba(16,24,40,.18); }
  .strip { display: flex; align-items: flex-end; height: 46px; padding: 0 10px 0 84px; background: #dde3ea; position: relative; }
  .lights { position: absolute; left: 16px; top: 17px; display: flex; gap: 8px; }
  .lights i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; }
  .lights i:nth-child(2) { background: #febc2e; } .lights i:nth-child(3) { background: #28c840; }
  .glabel { position: relative; flex: none; height: 36px; padding: 0 6px; display: flex; align-items: center; }
  .glabel span { height: 23px; padding: 0 8px; border-radius: 6px; display: flex; align-items: center;
                 background: var(--c); color: var(--fg); font-size: 13px; font-weight: 600; white-space: nowrap; }
  .in-group::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--c); z-index: 2; }
  .glabel::after { left: 6px; border-radius: 2px 0 0 2px; }
  .tab { position: relative; flex: 1 1 0; min-width: 0; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
         font-size: 12.5px; color: #3c4043; }
  .tab:not(.active)::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 1px; background: #bcc3cc; }
  .tab.active { background: #fff; border-radius: 10px 10px 0 0; color: #1f1f1f; }
  .tab.active::before, .tab.active + .tab::before, .glabel + .tab::before { display: none; }
  .tab .title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .fav { flex: none; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center;
         background: var(--fb); color: #fff; font-size: 9.5px; font-weight: 700; }
  .plus { flex: none; width: 30px; height: 36px; display: grid; place-items: center; color: #5f6368; font-size: 20px; }
  .toolbar { height: 44px; display: flex; align-items: center; gap: 14px; padding: 0 14px; border-bottom: 1px solid #e3e6ea; }
  .nav { display: flex; gap: 14px; color: #5f6368; font-size: 17px; }
  .omni { flex: 1; height: 30px; border-radius: 15px; background: #eef1f5; display: flex; align-items: center; padding: 0 14px;
          font-size: 13px; color: #3c4043; }
  .ext { width: 18px; height: 18px; border-radius: 4px; }
  .page { padding: 26px 40px; display: grid; gap: 14px; }
  .legend { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 22px; width: 1160px; }
  .legend div { background: #fff; border: 1px solid #e3e6ea; border-radius: 12px; padding: 14px 14px 12px;
                box-shadow: 0 1px 2px rgba(16,24,40,.05); }
  .legend .chip { display: inline-flex; height: 24px; padding: 0 8px; border-radius: 6px; align-items: center;
                  background: var(--c); color: var(--fg); font-size: 13px; font-weight: 600; }
  .legend b { display: block; margin-top: 10px; font-size: 14px; }
  .legend small { display: block; margin-top: 2px; font-size: 12.5px; color: #5b6470; }
  .page b { display: block; height: 12px; border-radius: 6px; background: #eef0f3; }
  .page b.h { height: 22px; width: 38%; background: #e3e7ec; margin-bottom: 10px; }
  .popup { position: absolute; right: 10px; top: 86px; width: 320px; border-radius: 12px; overflow: hidden;
           box-shadow: 0 2px 6px rgba(16,24,40,.12), 0 18px 44px rgba(16,24,40,.22); border: 1px solid #d5dae1; }
`;

// A Chrome window drawn from the real tab order, groups and colors.
function browserWindow(strip, { width, height, overlay = '' }) {
  const parts = [];
  let previous = null;
  for (const tab of strip) {
    const style = tab.group ? ` style="${groupStyle(tab.group)}"` : '';
    if (tab.group && tab.groupId !== previous) {
      parts.push(`<div class="glabel in-group"${style}><span>${esc(tab.group.title)}</span></div>`);
    }
    previous = tab.groupId;
    const info = TAB_INFO.get(tab.url) ?? { title: tab.url, letter: '', color: '#c4c9d0' };
    parts.push(
      `<div class="tab${tab.active ? ' active' : ''}${tab.group ? ' in-group' : ''}"${style}>` +
        `<span class="fav" style="--fb:${info.color}">${esc(info.letter)}</span><span class="title">${esc(info.title)}</span></div>`,
    );
  }
  const active = strip.find((t) => t.active);
  const lines = [92, 84, 88, 61, 0, 90, 77, 85, 52]
    .map((w) => (w ? `<b style="width:${w}%"></b>` : '<b style="height:0"></b>'))
    .join('');
  return `<div class="win" style="width:${width}px;height:${height}px">
    <div class="strip"><span class="lights"><i></i><i></i><i></i></span>${parts.join('')}<span class="plus">+</span></div>
    <div class="toolbar"><span class="nav"><span>←</span><span>→</span><span>↻</span></span>
      <div class="omni">${esc(active.url.replace(/^https:\/\//, ''))}</div><img class="ext" src="${ICON}" alt=""></div>
    <div class="page"><b class="h"></b>${lines}</div>${overlay}</div>`;
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; overflow: hidden; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
`;

function screenshotPage({ title, subtitle, body }) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}${WINDOW_CSS}
    body { width: 1280px; height: 800px; color: #1d2228;
           background: radial-gradient(1200px 500px at 15% -10%, #e4ecff 0%, transparent 60%),
                       radial-gradient(900px 500px at 100% 110%, #ffe6ee 0%, transparent 60%), #f6f7fa; }
    .cap { height: 170px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding-bottom: 26px; text-align: center; }
    .cap h1 { margin: 0; font-size: 40px; font-weight: 700; letter-spacing: -0.02em; }
    .cap p { margin: 10px 0 0; font-size: 19px; color: #5b6470; }
    .stage { height: 630px; display: flex; align-items: flex-start; justify-content: center; padding: 6px 60px 44px; }
    .shot { max-width: 1160px; max-height: 574px; border-radius: 14px; border: 1px solid #dfe3e8;
            box-shadow: 0 1px 2px rgba(16,24,40,.06), 0 20px 50px rgba(16,24,40,.16); }
  </style><div class="cap"><h1>${title}</h1><p>${subtitle}</p></div><div class="stage">${body}</div>`;
}

function groupStyle(group) {
  return `--c:${COLORS[group.color]};--fg:${group.color === 'yellow' ? '#202124' : '#fff'}`;
}

function groupsOf(strip) {
  const groups = new Map();
  for (const t of strip) if (t.group && !groups.has(t.groupId)) groups.set(t.groupId, t.group);
  return [...groups.values()];
}

function legend(strip) {
  const cards = groupsOf(strip).map((g) => {
    const [rule, note] = LEGEND[g.title] ?? [g.title, ''];
    return `<div><span class="chip" style="${groupStyle(g)}">${esc(g.title)}</span><b>${esc(rule)}</b><small>${esc(note)}</small></div>`;
  });
  return `<div class="legend">${cards.join('')}</div>`;
}

function chipRow(strip, size, limit) {
  return groupsOf(strip)
    .slice(0, limit)
    .map((g) => `<span class="chip" style="${groupStyle(g)}">${esc(g.title)}</span>`)
    .join('')
    .concat(`<style>.chip { display: inline-flex; align-items: center; height: ${size}px; padding: 0 ${size / 3}px; border-radius: ${size / 4.5}px;
      background: var(--c); color: var(--fg); font-size: ${size * 0.47}px; font-weight: 600; white-space: nowrap; }</style>`);
}

const PROMO_BG = `background: radial-gradient(600px 300px at 0% 0%, #34405c 0%, transparent 70%),
  radial-gradient(500px 300px at 100% 100%, #3a2a44 0%, transparent 70%), #1f2430;`;

function promoSmall(strip) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}
    body { width: 440px; height: 280px; ${PROMO_BG} color: #fff; padding: 34px 32px; display: flex; flex-direction: column; justify-content: space-between; }
    .brand { display: flex; align-items: center; gap: 16px; }
    .brand img { width: 64px; height: 64px; }
    h1 { margin: 0; font-size: 32px; letter-spacing: -0.02em; }
    p { margin: 4px 0 0; font-size: 16px; color: #c3cbdb; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  </style><div class="brand"><img src="${ICON}" alt=""><div><h1>Tab Grouplet</h1><p>Auto-group tabs with regex rules</p></div></div>
  <div class="chips">${chipRow(strip, 30, 4)}</div>`;
}

function promoMarquee(strip) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}${WINDOW_CSS}
    body { width: 1400px; height: 560px; ${PROMO_BG} color: #fff; display: flex; align-items: center; padding: 0 0 0 80px; gap: 56px; }
    .text { flex: none; width: 430px; }
    .text img { width: 88px; height: 88px; }
    h1 { margin: 22px 0 0; font-size: 56px; letter-spacing: -0.02em; }
    p { margin: 12px 0 28px; font-size: 23px; line-height: 1.35; color: #c3cbdb; }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; }
    .shotwrap { flex: none; width: 1160px; transform: scale(0.72); transform-origin: left center; }
  </style><div class="text"><img src="${ICON}" alt=""><h1>Tab Grouplet</h1>
    <p>Group Chrome tabs automatically with regex rules: names, emoji, colors and order.</p>
    <div class="chips">${chipRow(strip, 36, 5)}</div></div>
  <div class="shotwrap">${browserWindow(strip, { width: 1160, height: 520 })}</div>`;
}

async function render(sessionId, html, file, width, height) {
  const htmlFile = file.replace(/\.png$/, '.html');
  writeFileSync(htmlFile, html);
  await setViewport(sessionId, width, height, 1);
  await send('Page.navigate', { url: pathToFileURL(htmlFile).href }, sessionId);
  await waitReady(sessionId);
  await capture(sessionId, file);
}

// ---- Run ------------------------------------------------------------------------

try {
  const { id: extensionId } = await send('Extensions.loadUnpacked', { path: ROOT });
  const worker = await attachWorker(extensionId);
  const extensionUrl = (file) => `chrome-extension://${extensionId}/${file}`;

  // Demo rules and a window full of tabs; let the extension group them.
  console.error('· demo tabs');
  await evaluate(worker, `await chrome.storage.local.set({ rules: ${JSON.stringify(DEMO_RULES)}, paused: false });`);
  const demoWindow = await evaluate(
    worker,
    `const win = await chrome.windows.create({ url: ${JSON.stringify(DEMO_TABS.map(([url]) => url))} });
     return win.id;`,
  );
  await sleep(2500);
  await evaluate(
    worker,
    `const [tab] = await chrome.tabs.query({ windowId: ${demoWindow}, url: ${JSON.stringify(ACTIVE_URL)} });
     await chrome.tabs.update(tab.id, { active: true });`,
  );
  await sleep(500);
  const strip = await evaluate(
    worker,
    `const tabs = (await chrome.tabs.query({ windowId: ${demoWindow} })).sort((a, b) => a.index - b.index);
     const groups = Object.fromEntries((await chrome.tabGroups.query({ windowId: ${demoWindow} }))
       .map((g) => [g.id, { title: g.title ?? '', color: g.color }]));
     return tabs.map((t) => ({ url: t.pendingUrl || t.url, groupId: t.groupId, group: groups[t.groupId] ?? null, active: t.active }));`,
  );

  // Rules page: overview with the URL tester, one rule expanded, template menu.
  console.error('· rules page');
  const options = await openPage(extensionUrl('options/options.html'), { width: 920, height: 1700 });
  await evaluate(
    options.sessionId,
    `const input = document.querySelector('#test-url');
     input.value = 'localhost:3000/dashboard';
     input.dispatchEvent(new Event('input'));`,
  );
  await sleep(300);
  const overview = await areaOf(options.sessionId, ['.topbar', '.tester'], 0);
  await capture(options.sessionId, raw('rules.png'), { ...overview, height: overview.height + 24 });

  await evaluate(options.sessionId, `document.querySelectorAll('.rule [data-action="toggle"]')[2].click();`);
  await sleep(400);
  await capture(options.sessionId, raw('editor.png'), await areaOf(options.sessionId, ['.rule.open'], 8));

  await evaluate(
    options.sessionId,
    `document.querySelector('.rule.open [data-action="toggle"]').click();
     document.querySelector('#add').click();`,
  );
  await sleep(300);
  await capture(options.sessionId, raw('templates.png'), await areaOf(options.sessionId, ['.list-head', '#add-menu'], 20));
  await send('Target.closeTarget', { targetId: options.targetId });

  // Only the demo window stays, so the popup's counts describe it.
  console.error('· close other windows');
  await evaluate(
    worker,
    `for (const w of await chrome.windows.getAll()) if (w.id !== ${demoWindow}) await chrome.windows.remove(w.id);`,
  );

  // Popup, opened as a page. Its "active tab" lookup is pointed at the demo
  // window's GitHub tab, as if the toolbar icon was clicked there; a storage
  // change makes it render again with that tab.
  console.error('· popup');
  const popup = await openPage(extensionUrl('popup/popup.html'), { width: 300, height: 480 });
  await evaluate(
    popup.sessionId,
    `const query = chrome.tabs.query.bind(chrome.tabs);
     chrome.tabs.query = (info) =>
       query(info.active && info.currentWindow ? { windowId: ${demoWindow}, url: ${JSON.stringify(ACTIVE_URL)} } : info);
     await chrome.storage.local.set({ storeAssetsRefresh: Date.now() });`,
  );
  await sleep(800);
  const popupArea = await areaOf(popup.sessionId, ['body']);
  await capture(popup.sessionId, raw('popup.png'), { x: 0, y: 0, width: 300, height: Math.ceil(popupArea.height) });

  // Compose the store images.
  console.error('· compose');
  mkdirSync(OUT, { recursive: true });
  const canvas = await openPage('about:blank', { width: 1280, height: 800, scale: 1 });
  const build = (name) => path.join(work, name);
  const outputs = [
    ['screenshot-1-tab-groups.png', 1280, 800, screenshotPage({
      title: 'Your tabs, grouped automatically',
      subtitle: 'Regex rules sort every tab into named, colored groups, in the order you choose.',
      body: `<div>${browserWindow(strip, { width: 1160, height: 400 })}${legend(strip)}</div>`,
    })],
    ['screenshot-2-rules.png', 1280, 800, screenshotPage({
      title: 'One list of rules',
      subtitle: 'The first matching rule wins. Try any URL to see which group it lands in.',
      body: img(raw('rules.png')),
    })],
    ['screenshot-3-rule-editor.png', 1280, 800, screenshotPage({
      title: 'Regex in, group name out',
      subtitle: 'Name groups with captures like $1 and emoji. Set color, minimum tabs and position.',
      body: img(raw('editor.png')),
    })],
    ['screenshot-4-templates.png', 1280, 800, screenshotPage({
      title: 'Start from a template',
      subtitle: 'Localhost, LAN, Chrome pages, new tabs, hostnames, domains and subdomains.',
      body: img(raw('templates.png')),
    })],
    ['screenshot-5-popup.png', 1280, 800, screenshotPage({
      title: 'Always one click away',
      subtitle: "See the current tab's rule, pause or regroup, or add a rule for the site.",
      body: browserWindow(strip, { width: 1160, height: 560, overlay: img(raw('popup.png'), 'popup') }),
    })],
    ['promo-small-440x280.png', 440, 280, promoSmall(strip)],
    ['promo-marquee-1400x560.png', 1400, 560, promoMarquee(strip)],
  ];
  for (const [name, width, height, html] of outputs) {
    await render(canvas.sessionId, html, build(name), width, height);
    copyFileSync(build(name), path.join(OUT, name));
    console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, name))}`);
  }
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(work, { recursive: true, force: true });
}
