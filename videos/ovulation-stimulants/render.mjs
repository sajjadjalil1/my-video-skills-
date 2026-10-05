// Frame-accurate renderer: drives window.__seek(t) in headless Chromium and
// pipes screenshots into ffmpeg. Usage:
//   node render.mjs stills 1,8.2,20      -> out/still-<t>.png
//   node render.mjs video [fps] [workers] -> out/video.mp4 (+ soundtrack.wav if present)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, 'out');
mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.join(dir, 'index.html')).href + '?render=1';

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.evaluate(() => window.__ready);
  return { page, errors };
}

const [mode = 'stills', a1, a2] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--font-render-hinting=none'] });

if (mode === 'stills') {
  const times = (a1 || '1,8.3,13.5,20,30,37.5,44,50,57').split(',').map(Number);
  const { page, errors } = await openPage(browser);
  for (const t of times) {
    await page.evaluate(t => window.__seek(t), t);
    await page.screenshot({ path: path.join(out, `still-${t.toFixed(2)}.png`) });
  }
  console.log('stills done', errors.length ? errors : 'no errors');
} else {
  const fps = Number(a1 || 60), workers = Number(a2 || 4);
  const duration = 60, total = Math.round(duration * fps);
  const per = Math.ceil(total / workers);
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const from = w * per, to = Math.min(total, from + per);
    const file = path.join(out, `part-${w}.mp4`);
    const { page, errors } = await openPage(browser);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(fps), file], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = from; f < to; f++) {
      await page.evaluate(t => window.__seek(t), f / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (w === 0 && (f - from) % 60 === 0) console.log(`worker0 ${f - from}/${to - from}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    if (errors.length) console.log(`worker ${w} errors`, errors);
    return file;
  }));
  const list = path.join(out, 'parts.txt');
  writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'));
  const audio = path.join(dir, 'soundtrack.wav');
  const final = path.join(out, 'video.mp4');
  const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  if (existsSync(audio)) args.push('-i', audio, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-shortest');
  args.push('-c:v', 'copy', '-movflags', '+faststart', final);
  await new Promise((res, rej) => spawn('ffmpeg', args, { stdio: 'inherit' }).on('close', c => c ? rej(c) : res()));
  parts.forEach(p => rmSync(p)); rmSync(list);
  console.log('video done', final, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
