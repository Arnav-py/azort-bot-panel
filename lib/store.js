/**
 * Azort Control Panel — shared backend helpers.
 *
 * IMPORTANT (read before deploying):
 * Vercel serverless functions have a READ-ONLY filesystem at runtime, except
 * for /tmp, which is wiped between cold starts and is NOT shared across
 * function instances. The JSON read/write helpers below work great for local
 * development (`vercel dev`) and as a clear reference for your data shape,
 * but for a real deployment you have two options:
 *
 *   1. Swap DATA_DIR to a small persistent store — Vercel KV, Upstash Redis,
 *      or Turso (hosted SQLite) all have generous free tiers and a handful
 *      of lines to integrate. Keep the same function signatures below
 *      (readJSON/writeJSON) and just change what's inside them.
 *   2. Host this on a normal always-on Node process (a small VPS, Railway,
 *      Fly.io) instead of serverless — then the filesystem is persistent
 *      and nothing here needs to change.
 *
 * When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are configured,
 * JSON data is stored in Upstash so Vercel deployments can persist changes.
 * Without those variables, local development continues to use ./data.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(process.cwd(), 'data');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRemoteStore = Boolean(REDIS_URL && REDIS_TOKEN);

async function readJSON(file) {
  if (hasRemoteStore) {
    const response = await fetch(`${REDIS_URL}/get/azort:${file}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!response.ok) throw new Error(`Remote storage read failed (${response.status})`);
    const payload = await response.json();
    if (payload.result) return JSON.parse(payload.result);

    // Seed a new remote database from the checked-in data on first access.
    const localPath = path.join(DATA_DIR, file);
    if (!fs.existsSync(localPath)) return null;
    const initialData = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
    await writeJSON(file, initialData);
    return initialData;
  }

  if (process.env.VERCEL) {
    throw new Error('Persistent storage is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN) in Vercel.');
  }

  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function writeJSON(file, data) {
  if (hasRemoteStore) {
    const response = await fetch(REDIS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', `azort:${file}`, JSON.stringify(data)]),
    });
    if (!response.ok) throw new Error(`Remote storage write failed (${response.status})`);
    return;
  }

  const p = path.join(DATA_DIR, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/* ---------------- Password hashing (scrypt, salted) ---------------- */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(plain, salt, 64).toString('hex');
  // constant-time compare
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function genTempPassword() {
  return crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
}

/* ---------------- Signed session cookies (no DB session table needed) ---------------- */

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';

function sign(value) {
  const h = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}

function unsign(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

function createSessionCookie(name, payload, maxAgeSeconds = 60 * 60 * 8) {
  const raw = JSON.stringify(payload);
  const encoded = Buffer.from(raw).toString('base64url');
  const signed = sign(encoded);
  return `${name}=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookie(name) {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readSessionCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`));
  if (!match) return null;
  const signed = match.slice(name.length + 1);
  const encoded = unsign(signed);
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

/* ---------------- Cooldown store (in-memory; fine for single-instance) ---------------- */
/* NOTE: like the JSON files above, this resets on cold start / restart.
   That's an acceptable tradeoff at 10-20 users — see conversation notes
   on rate limiting. Swap for a KV store with a TTL if you want it to
   survive cold starts. */

const cooldowns = globalThis.__azortCooldowns || (globalThis.__azortCooldowns = new Map());
const COOLDOWN_SECONDS = 60;

function checkCooldown(key) {
  const last = cooldowns.get(key);
  const now = Date.now();
  if (last && now - last < COOLDOWN_SECONDS * 1000) {
    return { onCooldown: true, retryAfter: Math.ceil((COOLDOWN_SECONDS * 1000 - (now - last)) / 1000) };
  }
  return { onCooldown: false };
}

function setCooldown(key) {
  cooldowns.set(key, Date.now());
}

module.exports = {
  readJSON,
  writeJSON,
  hashPassword,
  verifyPassword,
  genTempPassword,
  createSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  checkCooldown,
  setCooldown,
  COOLDOWN_SECONDS,
};
