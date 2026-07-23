/* Azort Control Panel — client dashboard logic */

let currentBots = [];
let activeBotId = null;
let cooldownTimer = null;

function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 2600);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtBytes(bytes) {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function fmtUptime(ms) {
  if (!ms) return '—';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function statusLabel(status) {
  if (status === 'online') return 'Online';
  if (status === 'restarting') return 'Restarting…';
  return 'Offline';
}

function renderPulse(el, status) {
  el.className = 'pulse' + (status === 'online' ? '' : status === 'restarting' ? ' restarting' : ' offline');
}

async function loadBots() {
  const grid = document.getElementById('botGrid');
  if (!grid) return;

  try {
    const res = await fetch('/api/get-bots');
    if (res.status === 401) {
      window.location.href = '/index.html';
      return;
    }
    const data = await res.json();
    currentBots = data.bots || [];

    document.getElementById('userName').textContent = data.user?.displayName || data.user?.username || '—';
    document.getElementById('userInitial').textContent = (data.user?.displayName || data.user?.username || '?')[0].toUpperCase();

    if (currentBots.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <h3>No bots assigned yet</h3>
        <p>Once Azort assigns a bot to your account, it'll show up here.</p>
      </div>`;
      return;
    }

    grid.innerHTML = currentBots.map(bot => `
      <div class="bot-card" data-id="${bot.id}">
        <div class="bot-card-top">
          <div>
            <div class="bot-name">${bot.name}</div>
            <div class="bot-id mono">${bot.serverId}</div>
          </div>
        </div>
        <div class="status-row">
          <div class="pulse ${bot.status === 'online' ? '' : bot.status === 'restarting' ? 'restarting' : 'offline'}">
            <div class="pulse-ring"></div>
            <div class="pulse-ring"></div>
            <div class="pulse-dot"></div>
          </div>
          <span class="status-text ${bot.status}">${statusLabel(bot.status)}</span>
        </div>
        <div class="bot-meta">
          <span>Expires ${fmtDate(bot.expiresAt)}</span>
          <span>${bot.details?.node || bot.plan || 'Standard'}</span>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.bot-card').forEach(card => {
      card.addEventListener('click', () => openDrawer(card.dataset.id));
    });

  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <h3>Couldn't load your bots</h3>
      <p>Refresh the page — if this keeps happening, contact Azort support.</p>
    </div>`;
  }
}

function openDrawer(botId) {
  const bot = currentBots.find(b => b.id === botId);
  if (!bot) return;
  activeBotId = botId;

  document.getElementById('drawerName').textContent = bot.name;
  document.getElementById('drawerId').textContent = bot.serverId;
  document.getElementById('drawerExpiry').textContent = fmtDate(bot.expiresAt);
  document.getElementById('drawerLastAction').textContent = bot.lastAction || 'None yet';
  const details = bot.details || {};
  document.getElementById('drawerDescription').textContent = details.description || 'No server description available.';
  document.getElementById('drawerNode').textContent = details.node || '—';
  document.getElementById('drawerAllocation').textContent = details.allocation || '—';
  document.getElementById('drawerUptime').textContent = fmtUptime(details.uptime);
  document.getElementById('drawerCpuUsed').textContent = details.cpuUsed ? `${details.cpuUsed.toFixed(1)}%` : '—';
  document.getElementById('drawerCpuLimit').textContent = details.cpuLimit ? `${details.cpuLimit}% limit` : `${bot.cpuLimit || '—'}% limit`;
  document.getElementById('drawerMemUsed').textContent = details.memoryUsed ? fmtBytes(details.memoryUsed) : '—';
  document.getElementById('drawerMemLimit').textContent = details.memoryLimit ? `${fmtBytes(details.memoryLimit * 1024 * 1024)} limit` : `${bot.memLimit || '—'} MB limit`;
  document.getElementById('drawerDiskUsed').textContent = details.diskUsed ? fmtBytes(details.diskUsed) : '—';
  document.getElementById('drawerDiskLimit').textContent = details.diskLimit ? `${fmtBytes(details.diskLimit * 1024 * 1024)} limit` : '—';
  ['startBtn', 'restartBtn', 'stopBtn'].forEach(id => { document.getElementById(id).disabled = false; });
  document.getElementById('startBtn').disabled = bot.status === 'online';
  document.getElementById('stopBtn').disabled = bot.status === 'offline';
  document.getElementById('drawerStatusText').textContent = statusLabel(bot.status);
  document.getElementById('drawerStatusText').className = `status-text ${bot.status}`;
  renderPulse(document.getElementById('drawerPulse'), bot.status);
  document.getElementById('cooldownNote').textContent = '';

  document.getElementById('overlay').classList.add('show');
}

function closeDrawer() {
  document.getElementById('overlay').classList.remove('show');
  activeBotId = null;
}

async function sendAction(action) {
  if (!activeBotId) return;
  const actionButtons = ['startBtn', 'restartBtn', 'stopBtn'].map(id => document.getElementById(id));
  actionButtons.forEach(button => { button.disabled = true; });

  try {
    const res = await fetch('/api/bot-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId: activeBotId, action })
    });
    const data = await res.json();

    if (res.status === 429) {
      document.getElementById('cooldownNote').textContent =
        `Please wait ${data.retryAfter || 'a moment'} before trying again.`;
      showToast('Action on cooldown', 'err');
    } else if (!res.ok) {
      showToast(data.error || 'Action failed', 'err');
    } else {
      showToast(`${action[0].toUpperCase() + action.slice(1)} signal sent`, 'ok');
      closeDrawer();
      loadBots();
    }
  } catch (e) {
    showToast('Network error — try again', 'err');
  } finally {
    actionButtons.forEach(button => { button.disabled = false; });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBots();

  const overlay = document.getElementById('overlay');
  const drawerClose = document.getElementById('drawerClose');
  const restartBtn = document.getElementById('restartBtn');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDrawer(); });
  if (restartBtn) restartBtn.addEventListener('click', () => sendAction('restart'));
  if (startBtn) startBtn.addEventListener('click', () => sendAction('start'));
  if (stopBtn) stopBtn.addEventListener('click', () => sendAction('stop'));
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/index.html';
  });

  // periodic light refresh of cached status (not hammering Pterodactyl directly —
  // this just re-reads the backend's cached status store)
  setInterval(loadBots, 30000);
});
