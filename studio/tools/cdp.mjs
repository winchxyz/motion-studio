// A tiny Chrome DevTools Protocol client: launch Chrome, open one page, evaluate in it.
// Node 22+ has WebSocket built in, so no puppeteer is needed. (Adapted from credits-cubed/film.)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome']
  .find(p => p && fs.existsSync(p));

// port 0 (the default) lets Chrome pick a free debugging port and write it to DevToolsActivePort in its
// profile, so renders running side by side never reach each other's browser.
export async function launch({ port = 0, headless = true, width = 1280, height = 800, gpu = true, quiet = false } = {}) {
  if (!CHROME) throw new Error('Chrome not found; set CHROME=path');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hlr-'));
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(headless ? ['--headless=new'] : []),
    ...(gpu ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  let info = null;
  for (let i = 0; i < 100 && !info; i++) {
    await new Promise(r => setTimeout(r, 150));
    let p = port;
    if (!p) try { p = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
    if (p) try { info = await (await fetch(`http://127.0.0.1:${p}/json/list`)).json(); } catch {}
  }
  if (!info) throw new Error('Chrome did not open its debugging port');
  const target = info.find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const waiting = new Map();
  const listeners = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) { const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method) listeners.forEach(fn => fn(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const page = {
    send,
    on: fn => listeners.push(fn),
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url) {
      await send('Page.enable');
      const loaded = new Promise(res => listeners.push(m => { if (m.method === 'Page.loadEventFired') res(); }));
      await send('Page.navigate', { url });
      await loaded;
    },
    async close() {
      try { await send('Browser.close'); } catch {}
      proc.kill();
      await new Promise(r => setTimeout(r, 400));
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };
  await send('Runtime.enable');
  await send('Log.enable');
  page.on(m => {
    if (quiet) return;
    if (m.method === 'Log.entryAdded' && m.params.entry.level !== 'verbose') console.log('[page log]', m.params.entry.level, m.params.entry.text, m.params.entry.url || '', m.params.entry.lineNumber ?? '');
    if (m.method === 'Runtime.consoleAPICalled') console.log('[page]', m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') console.log('[page error]', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  return page;
}
