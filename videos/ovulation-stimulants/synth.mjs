// Procedural soundtrack + sound design, cue-locked to the timeline in index.html.
// node synth.mjs  ->  soundtrack.wav (48 kHz, stereo, 16-bit)
import { writeFileSync } from 'node:fs';

const SR = 48000, DUR = 60, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);       // dry bus
const RL = new Float32Array(N), RR = new Float32Array(N);     // reverb send
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const noiseR = rng(42), white = () => noiseR() * 2 - 1;
function bez(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = u => ((ax * u + bx) * u + cx) * u, sy = u => ((ay * u + by) * u + cy) * u;
  return x => { let lo = 0, hi = 1, u = x; for (let i = 0; i < 40; i++) { u = (lo + hi) / 2; sx(u) < x ? lo = u : hi = u; } return sy(u); };
}
const inOut = bez(.77, 0, .175, 1);

function put(i, v, pan = 0, send = .2) {
  if (i < 0 || i >= N) return;
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  L[i] += v * gl; R[i] += v * gr; RL[i] += v * gl * send; RR[i] += v * gr * send;
}
/* generic voice: freq(t) and amp(t) are functions of local time */
function voice(t0, dur, { f, a, wave = 'sine', pan = 0, send = .2, harm = 8 }) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, fr = f(t); ph += fr / SR;
    let v;
    if (wave === 'sine') v = Math.sin(TAU * ph);
    else if (wave === 'tri') v = 1 - 4 * Math.abs((ph % 1) - .5);
    else if (wave === 'saw') { v = 0; for (let h = 1; h <= harm; h++) if (fr * h < 12000) v += Math.sin(TAU * ph * h) / h * (1 - h / (harm + 1)); v *= .6; }
    else if (wave === 'sq') { v = 0; for (let h = 1; h <= harm; h += 2) if (fr * h < 12000) v += Math.sin(TAU * ph * h) / h; v *= .8; }
    put(s0 + i, v * a(t), typeof pan === 'function' ? pan(t) : pan, send);
  }
}
const env = (atk, dec) => t => t < atk ? t / atk : Math.exp(-(t - atk) / dec);
/* filtered noise (state-variable filter, per-sample cutoff) */
function noise(t0, dur, { a, fc = () => 2000, q = .7, mode = 'bp', pan = 0, send = .25, am = null }) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR); let lp = 0, bp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = clamp(fc(t), 20, 18000);
    const F = 2 * Math.sin(Math.PI * f / SR / 2), x = white();
    lp += F * bp; const hp = x - lp - q * bp; bp += F * hp;
    let v = mode === 'bp' ? bp : mode === 'lp' ? lp : hp;
    if (am) v *= am(t);
    put(s0 + i, v * a(t), typeof pan === 'function' ? pan(t) : pan, send);
  }
}

/* ------------------------------------------------------------- instruments */
const pluck = (t, m, g = .16, pan = 0) => {
  const f = mtof(m);
  voice(t, 1.4, { f: () => f, a: tt => g * env(.004, .32)(tt), pan, send: .45 });
  voice(t, .6, { f: () => f * 2, a: tt => g * .35 * env(.002, .12)(tt), pan, send: .45 });
  voice(t, .3, { f: () => f * 3.01, a: tt => g * .12 * env(.001, .05)(tt), pan, send: .45 });
};
const bell = (t, m, g = .12, pan = 0) => { const f = mtof(m); [[1, 1, 1.6], [2.76, .45, .7], [5.4, .25, .35], [8.93, .1, .2]].forEach(([r, k, d]) => voice(t, d * 2.5, { f: () => f * r, a: tt => g * k * env(.002, d)(tt), pan, send: .6 })); };
const pad = (t0, dur, notes, g = .05, wave = 'saw', atk = 1.2, rel = 1.5) => notes.forEach((m, j) => [-.07, .07].forEach((dt, k) => {
  const f = mtof(m) * (1 + dt / 12);
  voice(t0, dur + rel, { f: () => f, wave, harm: 6, pan: k ? .45 : -.45, send: .7, a: tt => g * clamp(tt / atk) * (tt > dur ? Math.exp(-(tt - dur) / (rel / 3)) : 1) * (1 + .15 * Math.sin(tt * 1.7 + j)) });
}));
const pop = (t, f0 = 600, g = .14, pan = 0) => voice(t, .12, { f: tt => f0 * (1 + 2.2 * Math.exp(-tt * 60)), a: tt => g * env(.002, .03)(tt), pan, send: .25 });
const tick = (t, g = .05, pan = 0) => noise(t, .04, { a: tt => g * Math.exp(-tt * 160), fc: () => 5200, q: .4, pan, send: .15 });
const kick = (t, g = .5, f1 = 46) => { voice(t, .5, { f: tt => f1 + 90 * Math.exp(-tt * 30), a: tt => g * env(.002, .16)(tt), send: .05 }); noise(t, .02, { a: () => g * .2, fc: () => 3000, send: 0 }); };
const hat = (t, g = .03, pan = .3) => noise(t, .05, { a: tt => g * Math.exp(-tt * 90), fc: () => 9000, mode: 'hp', q: .5, pan, send: .1 });
const whoosh = (t, dur, g = .2, f0 = 300, f1 = 4000, pan = null) => noise(t, dur, { a: tt => g * Math.pow(Math.sin(Math.PI * clamp(tt / dur)), 2), fc: tt => f0 * Math.pow(f1 / f0, tt / dur), q: .35, pan: pan || (tt => lerp(.7, -.7, tt / dur)), send: .35 });
const boom = (t, g = .9, f0 = 95, f1 = 32, dec = .55) => {
  voice(t, 2.4, { f: tt => f1 + (f0 - f1) * Math.exp(-tt * 4), a: tt => g * env(.003, dec)(tt), send: .3 });
  noise(t, .5, { a: tt => g * .5 * Math.exp(-tt * 14), fc: tt => 3000 * Math.exp(-tt * 6) + 120, mode: 'lp', q: .5, send: .5 });
};
const lubdub = (t, g = .4, pan = 0, f = 58) => { [[0, 1], [.15, .7]].forEach(([d, k]) => { voice(t + d, .3, { f: tt => f + 30 * Math.exp(-tt * 25), a: tt => g * k * env(.006, .07)(tt), pan, send: .1 }); noise(t + d, .08, { a: tt => g * k * .15 * Math.exp(-tt * 50), fc: () => 400, mode: 'lp', pan, send: 0 }); }); };
const beep = (t, g = .07, f = 988, d = .11) => voice(t, d, { f: () => f, a: tt => g * (tt < .005 ? tt / .005 : tt > d - .01 ? (d - tt) / .01 : 1), pan: -.2, send: .3 });

/* =============================================================== THE CUES */
// --- A. the question: light, curious (F major) 0 → 7.9
const arp = [[65, 69, 72, 76], [62, 65, 69, 72], [58, 62, 65, 69], [60, 64, 67, 72]];   // F  Dm  Bb  C
for (let b = 0; b < 15; b++) {
  const t = .5 + b * .5, ch = arp[Math.floor(b / 4) % 4];
  pluck(t, ch[(b * 2) % 4] + 12, .11, -.35); pluck(t + .25, ch[(b * 2 + 1) % 4] + 12, .08, .35);
  if (b % 4 === 0) pluck(t, ch[0] - 12, .14, 0);
}
pad(.2, 7.2, [53, 57, 60, 64], .018, 'tri', 1.5, .6);
pop(.35, 520, .1, .4); pop(.98, 700, .14, .4); pop(.65, 640, .1, -.4); pop(2.3, 760, .1, .4); pop(5.3, 520, .1, -.4); pop(5.98, 620, .14, -.4);
bell(1.55, 88, .07, .4); [2.2, 2.27, 2.33, 2.42].forEach((t, i) => bell(t, 93 + i * 2, .025, i % 2 ? .6 : -.6));
for (let i = 0; i < 12; i++) tick(1.05 + i * .085, .025, .3);
// riser into the slam
noise(6.6, 1.38, { a: tt => .22 * Math.pow(tt / 1.38, 2.2), fc: tt => 300 * Math.pow(30, tt / 1.38), q: .3, send: .3, pan: tt => Math.sin(tt * 9) * .4 });
voice(6.9, 1.08, { f: tt => 180 * Math.pow(4, tt / 1.08), a: tt => .05 * Math.pow(tt / 1.08, 2), wave: 'saw', harm: 5, send: .4 });

// --- B. NO 8.06
boom(8.06, 1, 110, 30, .75);
noise(8.06, .35, { a: tt => .45 * Math.exp(-tt * 18), fc: () => 2500, mode: 'hp', q: .4, send: .6 });
voice(8.06, 2.5, { f: () => mtof(38), wave: 'saw', harm: 10, a: tt => .14 * env(.01, .9)(tt), send: .6 });
// dark bed 9.5 → 32.4: drone + pulse
pad(9.4, 23, [38, 45, 50], .028, 'saw', 2.5, 1.2);
for (let t = 10; t < 32.3; t += .5) { kick(t, t < 12 ? .28 : .42, 44); if (t >= 12) hat(t + .25, .022, (t * 2) % 2 ? .3 : -.3); }
[10.35, 10.9, 11.45, 12.25, 13.45].forEach(t => tick(t, .05));
[11.6, 12.15].forEach(t => { noise(t, .1, { a: tt => .22 * Math.exp(-tt * 40), fc: () => 900, q: .6, send: .2 }); voice(t, .12, { f: tt => 240 - tt * 600, a: tt => .12 * env(.002, .04)(tt) }); });
// كوارث glitch
const glitch = (t, d, g) => { const r = rng(Math.floor(t * 100)); for (let k = 0; k < d / .03; k++) { const tt = t + k * .03; if (r() < .7) voice(tt, .028, { f: () => 80 + r() * 1800, wave: 'sq', harm: 9, a: () => g * (.4 + r() * .6), pan: r() * 1.4 - .7, send: .15 }); } noise(t, d, { a: () => g * .7, fc: () => 1800, q: .2, am: tt => (Math.floor(tt * 90) % 2), send: .1 }); };
boom(12.75, .55, 140, 40, .4); glitch(12.75, .5, .13); glitch(14.1, .16, .1); glitch(15.2, .12, .08); glitch(15.9, .1, .07);
// bars wipe
whoosh(16.2, .8, .26, 200, 6000); kick(16.98, .5, 40); noise(16.95, .5, { a: tt => .15 * Math.exp(-tt * 9), fc: () => 600, mode: 'lp', send: .5 });

// --- C. OHSS 17 → 32.4
boom(17.25, .5, 80, 34, .5);
const fr = rng(11), follT = [];
for (let i = 0; i < 26; i++) { const a = fr(), rr = fr(); const t0 = 17.9 + (i / 26) * 4.2 + fr() * .25; fr(); fr(); fr(); follT.push(t0); void a; void rr; }
follT.forEach((t, i) => pop(t, 420 + (i * 37) % 500, .07, ((i * 7) % 10) / 5 - 1));
voice(19.8, 3.1, { f: tt => 55 + tt * 10, a: tt => .12 * Math.pow(tt / 3.1, 1.6) * (1 + .5 * Math.sin(tt * 14)), wave: 'saw', harm: 6, send: .3 });
voice(19.8, 3.1, { f: tt => 57.5 + tt * 10.6, a: tt => .08 * Math.pow(tt / 3.1, 1.6), wave: 'saw', harm: 6, send: .3, pan: .5 });
[18.5, 18.75, 19.1].forEach(t => tick(t, .05));
whoosh(22.65, .9, .2, 2000, 300);
tick(23.35, .05);
// symptoms
[23.8, 26.0, 28.25].forEach(t => { kick(t, .3, 60); pop(t, 380, .1); });
{ const r = rng(9); for (let t = 24.1; t < 25.9; t += .07 + r() * .12) voice(t, .09, { f: tt => (300 + r() * 500) * (1 + tt * 8), a: tt => .05 * env(.004, .03)(tt), pan: r() - .5, send: .4 }); }
[50, 51, 57].forEach((m, k) => voice(26.0, 1.6, { f: () => mtof(m) * (1 + k * .004), wave: 'saw', harm: 9, a: tt => .07 * env(.005, .45)(tt), pan: k - 1, send: .5 }));
for (let t = 26.25; t < 28.2; t += .419) voice(t, .25, { f: () => 74, wave: 'saw', harm: 5, a: tt => .07 * env(.01, .08)(tt), send: .2 });
for (let t = 28.7; t < 32.3; t += 1.25) beep(t);
// ECG sweep: beeps exactly where the pen crosses each R spike
{
  const x = t => lerp(1120, -80, inOut(clamp((t - 32.4) / .95)));
  let prev = x(32.4);
  for (let t = 32.4; t < 33.36; t += 1 / SR * 16) {
    const cur = x(t);
    for (let k = 0; k < 7; k++) { const xr = 1120 - (k * 220 + .51 * 220); if (prev > xr && cur <= xr) beep(t, .08, 988 + k * 30, .07); }
    prev = cur;
  }
  noise(32.35, 1.05, { a: tt => .1 * Math.sin(Math.PI * tt / 1.05), fc: tt => 1200 + tt * 3000, q: .5, send: .4, pan: tt => lerp(.8, -.8, tt / 1.05) });
}

// --- D. multiples 33.3 → 40.3
boom(33.35, .45, 70, 32, .5);
pad(33.3, 6.9, [38, 41, 45, 46], .022, 'saw', 1.5, .8);
[33.4, 33.75].forEach(t => tick(t, .05));
const rates = [1.55, 1.9, 2.3, 1.25], phs = [0, .3, .55, .8], born = [34.2, 34.9, 35.75, 36.6];
rates.forEach((rt, i) => { for (let k = 0; k < 40; k++) { const t = (k + .25 - phs[i]) / rt; if (t >= born[i] && t < 40.0) lubdub(t - .03, .26, [-.5, .5, -.25, .25][i], [58, 62, 55, 66][i]); } });
[34.9, 35.75, 36.6].forEach((t, i) => { voice(t, .35, { f: tt => 500 - tt * 900 + i * 60, a: tt => .1 * env(.01, .1)(tt), send: .4 }); noise(t, .2, { a: tt => .06 * Math.exp(-tt * 20), fc: () => 700, q: .8, send: .3 }); pop(t + .05, 300 + i * 80, .1); });
voice(36.6, 3.5, { f: tt => mtof(74) + Math.sin(tt * 30) * 6, wave: 'tri', a: tt => .03 * clamp(tt / .8) * (1 - clamp((tt - 3) / .5)), send: .5 });
boom(37.25, .35, 120, 45, .3); tick(37.75, .05);
noise(39.5, 1.0, { a: tt => .2 * Math.pow(tt, 2.5), fc: tt => 400 + tt * 3000, q: .4, send: .3 });

// --- E. split 40.3 → 46.3
whoosh(40.4, .7, .22, 300, 3500, tt => 0); pop(40.55, 340, .12);
pad(40.8, 5.6, [45, 48, 52], .016, 'tri', 1, 1);
whoosh(41.0, .65, .13, 800, 2500); pop(41.72, 820, .08, .5); pop(41.75, 760, .08, -.5);
bell(41.9, 84, .09, .45); bell(41.98, 88, .06, .45);
[110, 116.5].forEach(f => voice(42.35, .38, { f: () => f, wave: 'sq', harm: 11, a: tt => .07 * env(.004, .16)(tt), pan: -.45, send: .2 }));
kick(42.35, .3, 50);
[42.85, 43.45].forEach(t => tick(t, .05)); boom(43.45, .3, 100, 40, .3);
noise(44.0, .6, { a: tt => .05 * Math.sin(Math.PI * tt / .6), fc: () => 3000, q: .9, send: .2 });

// --- F. tailored 46.3 → 60 (F major returns, resolved)
const zip = (t, d, g) => noise(t, d, { a: tt => g * Math.sin(Math.PI * clamp(tt / d)), fc: tt => 1500 + 2500 * tt / d, q: .6, am: tt => .35 + .65 * (Math.sin(TAU * 70 * tt) > .3 ? 1 : 0), send: .2, pan: tt => lerp(.8, -.8, tt / d) });
zip(46.35, .95, .2); whoosh(46.35, .95, .12, 400, 3000);
zip(48.3, .7, .14);
[[47.35, 0], [47.8, 0], [48.75, 0]].forEach(([t]) => tick(t, .05));
const arp2 = [[65, 69, 72, 77], [58, 62, 65, 70], [60, 64, 67, 72], [65, 69, 72, 76]];
for (let b = 0; b < 22; b++) {
  const t = 47.5 + b * .5, ch = arp2[Math.floor(b / 4) % 4];
  if (t > 53.6) break;
  pluck(t, ch[(b * 2) % 4] + 12, .1, -.35); pluck(t + .25, ch[(b * 2 + 1) % 4] + 12, .075, .35);
  if (b % 4 === 0) pluck(t, ch[0] - 12, .15, 0);
}
pad(47.4, 6.4, [53, 57, 60, 64], .02, 'tri', 1.5, .8);
for (let t = 47.75; t < 50.3; t += .12) tick(t, .012, (t * 7) % 2 - 1);
kick(49.55, .55, 42); noise(49.55, .25, { a: tt => .25 * Math.exp(-tt * 22), fc: () => 1100, q: .5, send: .4 }); bell(49.6, 77, .05);
pop(50.2, 900, .08, .6); pop(50.34, 980, .08, -.6);
whoosh(53.7, .7, .1, 2500, 500);
// end card
for (let i = 0; i < 2; i++) beep(54.6 + i * .28, .05, 880, .08);
pad(54.8, 4.4, [53, 60, 64, 69, 72], .026, 'tri', 1.2, 1.4);
pluck(55.35, 41, .2); bell(55.35, 81, .08, -.3); bell(55.5, 88, .06, .3); bell(56.0, 93, .04, 0);
for (let k = 0; k < 5; k++) { const t = 56 + (k + .5) / 1.4; if (t < 59.3) lubdub(t - .02, .13, 0, 56); }

/* ------------------------------------------------------------- reverb + master */
function reverb(inp, delays, fb = .82, damp = .3) {
  const out = new Float32Array(N);
  delays.forEach(d => { const buf = new Float32Array(d); let idx = 0, lp = 0; for (let i = 0; i < N; i++) { const y = buf[idx]; lp = y * (1 - damp) + lp * damp; buf[idx] = inp[i] + lp * fb; idx = (idx + 1) % d; out[i] += y / delays.length; } });
  [556, 441, 341].forEach(d => { const buf = new Float32Array(d); let idx = 0; for (let i = 0; i < N; i++) { const b = buf[idx], x = out[i]; const y = -x + b; buf[idx] = x + b * .5; idx = (idx + 1) % d; out[i] = y; } });
  return out;
}
const wl = reverb(RL, [1687, 1601, 2053, 2251]), wr = reverb(RR, [1709, 1637, 2111, 2293]);
let peak = 0;
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / (SR * .02), (N - i) / (SR * 1.6));
  L[i] = Math.tanh((L[i] + wl[i] * .55) * 1.1) * fade; R[i] = Math.tanh((R[i] + wr[i] * .55) * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = .89 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(clamp(L[i] * gain, -1, 1) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(clamp(R[i] * gain, -1, 1) * 32767), 46 + i * 4); }
writeFileSync(new URL('./soundtrack.wav', import.meta.url), buf);
console.log('soundtrack.wav written, peak before gain', peak.toFixed(3));
