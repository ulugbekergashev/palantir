/*
 * Kalit sahifasining kriptografiyasi — sof JS: telefonda HTML fayl sifatida ochilganda crypto.subtle bo'lmasligi mumkin.
 * Sahifaga (template.html) aynan shu matn qo'yiladi; scripts/check-kalit-sahifa.ts uni Node'dagi crypto bilan solishtiradi.
 *   SHA-256 / HMAC / PBKDF2 — parol bilan shifrlangan maxfiy qismni ochish (DentaLocal key-page bilan bir xil sxema)
 *   DentaCRM kaliti — dentalocal/backend/licenseService.ts formulasi
 *   SHA-512 / Ed25519 imzo — Palantir kaliti (hub/licenseKey.ts: PAL1-…)
 */
'use strict';
// eslint-disable-next-line no-unused-vars -- sahifa va tekshiruv shu nom bilan oladi
var KalitCrypto = (function () {
  /* ───────── SHA-256 ───────── */
  const K = new Int32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const IV = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const W = new Int32Array(64);

  function compress(H) {
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = (W[i - 16] + ((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ (a >>> 3)) + W[i - 7] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ (b >>> 10))) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  function loadBlock(bytes, off) {
    for (let i = 0; i < 16; i++) { const p = off + i * 4; W[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]; }
  }
  function wordsToBytes(H) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) { out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 255; out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255; }
    return out;
  }
  function sha256(bytes) {
    // Bloklar soni: ceil((len + 9) / 64). DentaLocal sahifasidagi (((len + 9) >> 6) + 1) uzunligi 55 (mod 64) bo'lganda xato xesh berardi
    const len = bytes.length, total = (((len + 8) >> 6) + 1) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes); buf[len] = 0x80;
    const bits = len * 8;
    buf[total - 4] = bits >>> 24; buf[total - 3] = (bits >>> 16) & 255; buf[total - 2] = (bits >>> 8) & 255; buf[total - 1] = bits & 255;
    buf[total - 5] = Math.floor(len / 0x20000000) & 255;
    const H = Int32Array.from(IV);
    for (let off = 0; off < total; off += 64) { loadBlock(buf, off); compress(H); }
    return wordsToBytes(H);
  }
  function concat() {
    let n = 0;
    for (const a of arguments) n += a.length;
    const o = new Uint8Array(n);
    let at = 0;
    for (const a of arguments) { o.set(a, at); at += a.length; }
    return o;
  }
  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    const ip = new Uint8Array(64), op = new Uint8Array(64);
    for (let i = 0; i < 64; i++) { const k = key[i] || 0; ip[i] = k ^ 0x36; op[i] = k ^ 0x5c; }
    return sha256(concat(op, sha256(concat(ip, msg))));
  }
  /** PBKDF2-HMAC-SHA256, 32 bayt. Bo'laklab ishlaydi — ekran qotib qolmaydi, onProgress(0..1) */
  function pbkdf2(password, salt, iterations, onProgress) {
    const key = password.length > 64 ? sha256(password) : password;
    const ip = new Uint8Array(64), op = new Uint8Array(64);
    for (let i = 0; i < 64; i++) { const k = key[i] || 0; ip[i] = k ^ 0x36; op[i] = k ^ 0x5c; }
    const Hi = Int32Array.from(IV), Ho = Int32Array.from(IV);
    loadBlock(ip, 0); compress(Hi);
    loadBlock(op, 0); compress(Ho);
    const u1 = hmac(password, concat(salt, new Uint8Array([0, 0, 0, 1])));
    const U = new Int32Array(8), T = new Int32Array(8), A = new Int32Array(8), B = new Int32Array(8);
    for (let i = 0; i < 8; i++) { U[i] = (u1[i * 4] << 24) | (u1[i * 4 + 1] << 16) | (u1[i * 4 + 2] << 8) | u1[i * 4 + 3]; T[i] = U[i]; }
    let done = 1;
    return new Promise(resolve => {
      const step = () => {
        const until = Math.min(iterations, done + 20000);
        for (; done < until; done++) {
          // Ichki: H(ipad || U) — U 32 bayt, jami 96 bayt → bitta qo'shimcha blok
          A.set(Hi);
          W[0] = U[0]; W[1] = U[1]; W[2] = U[2]; W[3] = U[3]; W[4] = U[4]; W[5] = U[5]; W[6] = U[6]; W[7] = U[7];
          W[8] = 0x80000000 | 0; W[9] = 0; W[10] = 0; W[11] = 0; W[12] = 0; W[13] = 0; W[14] = 0; W[15] = 768;
          compress(A);
          B.set(Ho);
          W[0] = A[0]; W[1] = A[1]; W[2] = A[2]; W[3] = A[3]; W[4] = A[4]; W[5] = A[5]; W[6] = A[6]; W[7] = A[7];
          W[8] = 0x80000000 | 0; W[9] = 0; W[10] = 0; W[11] = 0; W[12] = 0; W[13] = 0; W[14] = 0; W[15] = 768;
          compress(B);
          for (let i = 0; i < 8; i++) { U[i] = B[i]; T[i] ^= B[i]; }
        }
        if (onProgress) onProgress(done / iterations);
        if (done < iterations) setTimeout(step, 0); else resolve(wordsToBytes(T));
      };
      step();
    });
  }

  const enc = s => new TextEncoder().encode(s);
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const unhex = h => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };

  /** Parol to'g'ri bo'lsa ochilgan JSON ({l, r, p}), aks holda null */
  async function unlock(payload, password, onProgress) {
    const dk = await pbkdf2(enc(password), unhex(payload.s), payload.it, onProgress);
    const ct = unhex(payload.c);
    const tag = hmac(hmac(dk, enc('mac')), ct);
    const want = unhex(payload.t);
    let diff = tag.length ^ want.length;
    for (let i = 0; i < tag.length; i++) diff |= tag[i] ^ want[i];
    if (diff !== 0) return null;
    const pt = new Uint8Array(ct.length);
    for (let off = 0, n = 0; off < ct.length; off += 32, n++) {
      const ks = hmac(dk, concat(enc('enc'), new Uint8Array([n])));
      for (let i = 0; i < 32 && off + i < ct.length; i++) pt[off + i] = ct[off + i] ^ ks[i];
    }
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /* ───────── DentaCRM — backend/licenseService.ts bilan AYNAN bir xil formula ───────── */
  const dentaLicense = (id, salt) => hex(sha256(enc(id + salt))).substring(0, 24).toUpperCase();
  const dentaRecovery = (id, salt) => hex(sha256(enc(id + salt))).substring(0, 20).toUpperCase();

  /* ───────── SHA-512 (BigInt): konstantalar tub sonlardan hisoblanadi — qo'lda yozilgan jadvalda xato bo'lmasin ───────── */
  const M64 = (1n << 64n) - 1n;
  const PRIMES = [];
  for (let n = 2; PRIMES.length < 80; n++) if (PRIMES.every(p => n % p)) PRIMES.push(n);
  /** floor(v^(1/k)) — Newton usuli, yuqoridan */
  function iroot(v, k) {
    const bk = BigInt(k);
    let x = 1n << BigInt(Math.ceil(v.toString(2).length / k));
    for (;;) {
      const y = ((bk - 1n) * x + v / x ** (bk - 1n)) / bk;
      if (y >= x) return x;
      x = y;
    }
  }
  const K512 = PRIMES.map(p => iroot(BigInt(p) << 192n, 3) & M64);
  const H512 = PRIMES.slice(0, 8).map(p => iroot(BigInt(p) << 128n, 2) & M64);
  const rotr = (x, n) => ((x >> n) | (x << (64n - n))) & M64;
  function sha512(bytes) {
    const len = bytes.length, total = Math.ceil((len + 17) / 128) * 128;
    const buf = new Uint8Array(total);
    buf.set(bytes); buf[len] = 0x80;
    let bits = BigInt(len) * 8n;
    for (let i = 0; i < 8; i++) { buf[total - 1 - i] = Number(bits & 255n); bits >>= 8n; }
    const H = H512.slice(), w = Array.from({ length: 80 }, () => 0n);
    for (let off = 0; off < total; off += 128) {
      for (let i = 0; i < 16; i++) { let v = 0n; for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(buf[off + i * 8 + j]); w[i] = v; }
      for (let i = 16; i < 80; i++) {
        const s0 = rotr(w[i - 15], 1n) ^ rotr(w[i - 15], 8n) ^ (w[i - 15] >> 7n);
        const s1 = rotr(w[i - 2], 19n) ^ rotr(w[i - 2], 61n) ^ (w[i - 2] >> 6n);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M64;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 80; i++) {
        const t1 = (h + (rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n)) + ((e & f) ^ (~e & M64 & g)) + K512[i] + w[i]) & M64;
        const t2 = ((rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n)) + ((a & b) ^ (a & c) ^ (b & c))) & M64;
        h = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
      }
      H[0] = (H[0] + a) & M64; H[1] = (H[1] + b) & M64; H[2] = (H[2] + c) & M64; H[3] = (H[3] + d) & M64;
      H[4] = (H[4] + e) & M64; H[5] = (H[5] + f) & M64; H[6] = (H[6] + g) & M64; H[7] = (H[7] + h) & M64;
    }
    const out = new Uint8Array(64);
    for (let i = 0; i < 8; i++) { let v = H[i]; for (let j = 7; j >= 0; j--) { out[i * 8 + j] = Number(v & 255n); v >>= 8n; } }
    return out;
  }

  /* ───────── Ed25519 (RFC 8032) — faqat imzolash; sotuvchining o'z telefonida, tezlik muhim emas ───────── */
  const P = (1n << 255n) - 19n;
  const L = (1n << 252n) + 27742317777372353535851937790883648493n;
  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
  function powmod(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
  const inv = a => powmod(a, P - 2n, P);
  const D = mod(-121665n * inv(121666n));
  const GX = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
  const GY = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
  const G = [GX, GY, 1n, mod(GX * GY)];
  /** Kengaytirilgan koordinatalarda qo'shish (a = -1; ikkilantirish uchun ham to'g'ri) */
  function add(p, q) {
    const A = mod((p[1] - p[0]) * (q[1] - q[0])), B = mod((p[1] + p[0]) * (q[1] + q[0]));
    const C = mod(2n * D * p[3] * q[3]), DD = mod(2n * p[2] * q[2]);
    const E = B - A, F = DD - C, H = DD + C, I = B + A;
    return [mod(E * F), mod(H * I), mod(F * H), mod(E * I)];
  }
  function mul(k, p) {
    let r = [0n, 1n, 1n, 0n], q = p;
    while (k > 0n) { if (k & 1n) r = add(r, q); q = add(q, q); k >>= 1n; }
    return r;
  }
  const leInt = b => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };
  const leBytes = (n, len) => { const o = new Uint8Array(len); for (let i = 0; i < len; i++) { o[i] = Number(n & 255n); n >>= 8n; } return o; };
  function encodePoint(p) {
    const zi = inv(p[2]), x = mod(p[0] * zi), y = mod(p[1] * zi);
    const out = leBytes(y, 32);
    if (x & 1n) out[31] |= 0x80;
    return out;
  }
  /** seed — 32 bayt maxfiy kalit (PKCS8 ichidagi), msg — baytlar; javob — 64 bayt imzo */
  function ed25519Sign(seed, msg) {
    const h = sha512(seed);
    const s = h.slice(0, 32);
    s[0] &= 248; s[31] &= 127; s[31] |= 64;
    const a = leInt(s);
    const A = encodePoint(mul(a, G));
    const r = mod(leInt(sha512(concat(h.slice(32), msg))), L);
    const R = encodePoint(mul(r, G));
    const k = mod(leInt(sha512(concat(R, A, msg))), L);
    return concat(R, leBytes(mod(r + k * a, L), 32));
  }
  /** Ochiq kalit (32 bayt) — sahifa o'zini tekshirishi uchun */
  function ed25519Public(seed) {
    const s = sha512(seed).slice(0, 32);
    s[0] &= 248; s[31] &= 127; s[31] |= 64;
    return encodePoint(mul(leInt(s), G));
  }

  /* ───────── Palantir kaliti — hub/licenseKey.ts bilan AYNAN bir xil ko'rinish ───────── */
  const DAY_MS = 86400000;
  /** 16 ta o'n oltilik belgi (bo'shliq, chiziq va kichik harf bilan yozilsa ham) → XXXX-XXXX-XXXX-XXXX, aks holda null */
  function normalizeMachineId(text) {
    const h = String(text || '').replace(/[\s\-​‎‏﻿]/g, '').toUpperCase();
    return /^[0-9A-F]{16}$/.test(h) ? h.match(/.{4}/g).join('-') : null;
  }
  function base64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function palantirLicense(seed, machineId, now) {
    const norm = normalizeMachineId(machineId);
    if (!norm) throw new Error("Kompyuter kodi noto'g'ri");
    const id = unhex(norm.replace(/-/g, ''));
    const dayNum = Math.floor((now === undefined ? Date.now() : now) / DAY_MS);
    const day = new Uint8Array([(dayNum >>> 24) & 255, (dayNum >>> 16) & 255, (dayNum >>> 8) & 255, dayNum & 255]);
    const sig = ed25519Sign(seed, concat(enc('palantir-litsenziya\n'), id, day));
    return 'PAL1-' + base64url(concat(id, day, sig));
  }

  return { sha256, sha512, hmac, pbkdf2, unlock, hex, unhex, enc, dentaLicense, dentaRecovery, ed25519Sign, ed25519Public, normalizeMachineId, palantirLicense };
})();
