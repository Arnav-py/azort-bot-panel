/**
 * Thin wrapper around the Pterodactyl Client API (used by Orihost).
 *
 * This is the ONLY file that should ever touch PTERODACTYL_API_KEY.
 * The key lives in Vercel's environment variables — never in the repo,
 * never sent to the browser, never logged.
 *
 * Docs: https://dashflo.net/docs/api/pterodactyl/client/
 */

const BASE_URL = process.env.PTERODACTYL_BASE_URL; // e.g. https://panel.orihost.example
const API_KEY = process.env.PTERODACTYL_API_KEY;    // your master client API key

async function sendPowerSignal(serverId, signal) {
  // signal: 'start' | 'stop' | 'restart' | 'kill'
  if (!BASE_URL || !API_KEY) {
    throw new Error('Pterodactyl credentials are not configured (set PTERODACTYL_BASE_URL / PTERODACTYL_API_KEY).');
  }

  const res = await fetch(`${BASE_URL}/api/client/servers/${serverId}/power`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ signal }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pterodactyl power signal failed (${res.status}): ${text}`);
  }

  return true;
}

async function getServerStatus(serverId) {
  if (!BASE_URL || !API_KEY) {
    // Demo fallback so the panel is functional without real credentials wired up yet.
    return 'offline';
  }

  const res = await fetch(`${BASE_URL}/api/client/servers/${serverId}/resources`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) return 'offline';
  const data = await res.json();
  // Pterodactyl returns current_state: 'running' | 'stopping' | 'starting' | 'offline'
  const state = data?.attributes?.current_state;
  if (state === 'running') return 'online';
  if (state === 'starting' || state === 'stopping') return 'restarting';
  return 'offline';
}

module.exports = { sendPowerSignal, getServerStatus };
