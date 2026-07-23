/* Azort Devs — client management logic */

let clients = [];

function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 2600);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function loadClients() {
  const body = document.getElementById('clientsBody');
  try {
    const res = await fetch('/api/devs-clients');
    if (res.status === 401) {
      window.location.href = '/devs/index.html';
      return;
    }
    const data = await res.json();
    clients = data.clients || [];

    if (clients.length === 0) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:30px;">No clients yet — add your first one.</td></tr>`;
      return;
    }

    body.innerHTML = clients.map(c => `
      <tr>
        <td><strong>${c.username}</strong></td>
        <td><div class="client-server-list">${(c.bots || []).map(bot => `
          <button class="admin-server-card" data-server="${encodeURIComponent(JSON.stringify({ ...bot, clientName: c.username }))}">
            <span><strong>${bot.name}</strong><span>${bot.status || 'offline'} · ${bot.plan || 'Standard'}</span></span><b class="admin-server-arrow">&rarr;</b>
          </button>`).join('') || '<span>—</span>'}</div></td>
        <td><span class="badge ${c.status === 'active' ? 'active' : 'expired'}">${c.status === 'active' ? 'Active' : 'Expired'}</span></td>
        <td>${fmtDate(c.expiresAt)}</td>
        <td>${c.lastLogin ? fmtDate(c.lastLogin) : 'Never'}</td>
        <td>
          <div class="row-actions">
            <button class="btn-ghost" data-edit="${c.id}">Edit</button>
            <button class="btn-ghost" data-reset="${c.id}">Reset pass</button>
          </div>
        </td>
      </tr>
    `).join('');

    body.querySelectorAll('[data-edit]').forEach(btn =>
      btn.addEventListener('click', () => openModal(btn.dataset.edit)));
    body.querySelectorAll('[data-reset]').forEach(btn =>
      btn.addEventListener('click', () => resetPassword(btn.dataset.reset)));
    body.querySelectorAll('[data-server]').forEach(btn =>
      btn.addEventListener('click', () => openServerDetail(JSON.parse(decodeURIComponent(btn.dataset.server)))));

  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:30px;">Couldn't load clients.</td></tr>`;
  }
}

function openServerDetail(bot) {
  document.getElementById('adminDetailName').textContent = bot.name || 'Server';
  document.getElementById('adminDetailClient').textContent = bot.clientName || '—';
  document.getElementById('adminDetailExpiry').textContent = fmtDate(bot.expiresAt);
  document.getElementById('adminDetailId').textContent = bot.serverId || '—';
  document.getElementById('adminDetailPlan').textContent = bot.plan || 'Standard';
  document.getElementById('adminDetailCpu').textContent = bot.cpuLimit ? `${bot.cpuLimit}%` : '—';
  document.getElementById('adminDetailMemory').textContent = bot.memLimit ? `${bot.memLimit} MB` : '—';
  document.getElementById('adminDetailAction').textContent = bot.lastAction || 'None yet';
  document.getElementById('adminDetailAccess').textContent = bot.status === 'suspended' ? 'Suspended' : 'Active';
  document.getElementById('adminDetailStatus').textContent = bot.status === 'online' ? 'Online' : bot.status === 'restarting' ? 'Restarting' : 'Offline';
  document.getElementById('adminDetailStatus').className = `status-text ${bot.status === 'online' ? 'online' : bot.status === 'restarting' ? 'restarting' : 'offline'}`;
  renderAdminPulse(bot.status);
  document.getElementById('serverDetailOverlay').classList.add('show');
}

function renderAdminPulse(status) {
  const pulse = document.getElementById('adminDetailPulse');
  pulse.className = `pulse ${status === 'online' ? '' : status === 'restarting' ? 'restarting' : 'offline'}`;
}

function closeServerDetail() {
  document.getElementById('serverDetailOverlay').classList.remove('show');
}

function openModal(clientId = null) {
  const overlay = document.getElementById('overlay');
  const form = document.getElementById('clientForm');
  form.reset();

  if (clientId) {
    const c = clients.find(x => x.id === clientId);
    document.getElementById('modalTitle').textContent = 'Edit client';
    document.getElementById('clientId').value = c.id;
    document.getElementById('cUsername').value = c.username;
    document.getElementById('serverAssignments').innerHTML = '';
    (c.bots || []).forEach(bot => addAssignmentRow(bot));
    document.getElementById('cStatus').value = c.status;
    document.getElementById('tempPassWrap').style.display = 'none';
  } else {
    document.getElementById('modalTitle').textContent = 'Add client';
    document.getElementById('clientId').value = '';
    document.getElementById('tempPassWrap').style.display = 'block';
    document.getElementById('serverAssignments').innerHTML = '';
    addAssignmentRow();
  }

  overlay.classList.add('show');
}

function closeModal() {
  document.getElementById('overlay').classList.remove('show');
}

async function saveClient(e) {
  e.preventDefault();
  const id = document.getElementById('clientId').value;
  const payload = {
    id: id || undefined,
    username: document.getElementById('cUsername').value.trim(),
    bots: readAssignments(),
    status: document.getElementById('cStatus').value,
    tempPassword: document.getElementById('cTempPass').value || undefined
  };

  try {
    const res = await fetch('/api/devs-clients', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Save failed', 'err');
      return;
    }

    showToast(id ? 'Client updated' : `Client added${data.tempPassword ? ` — temp password: ${data.tempPassword}` : ''}`, 'ok');
    closeModal();
    loadClients();
  } catch (err) {
    showToast('Network error', 'err');
  }
}

async function resetPassword(clientId) {
  if (!confirm('Generate a new temporary password for this client?')) return;
  try {
    const res = await fetch('/api/devs-clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clientId, action: 'reset-password' })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Reset failed', 'err');
      return;
    }
    showToast(`New temp password: ${data.tempPassword}`, 'ok');
  } catch (e) {
    showToast('Network error', 'err');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadClients();

  document.getElementById('addClientBtn').addEventListener('click', () => openModal());
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') closeModal();
  });
  document.getElementById('serverDetailClose').addEventListener('click', closeServerDetail);
  document.getElementById('serverDetailOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'serverDetailOverlay') closeServerDetail();
  });
  document.getElementById('clientForm').addEventListener('submit', saveClient);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/devs-logout', { method: 'POST' });
    window.location.href = '/devs/index.html';
  });
  document.getElementById('addServerBtn').addEventListener('click', () => addAssignmentRow());
});

function addAssignmentRow(bot = {}) {
  const row = document.createElement('div');
  row.className = 'assignment-row';
  row.innerHTML = `
    <input type="hidden" class="assignment-id" value="${bot.id || ''}">
    <input class="assignment-name" required placeholder="Display name" value="${bot.name || ''}">
    <input class="assignment-server mono" required placeholder="Pterodactyl server ID" value="${bot.serverId || ''}">
    <input class="assignment-expiry" type="date" value="${bot.expiresAt ? bot.expiresAt.split('T')[0] : ''}">
    <button type="button" class="btn-ghost assignment-remove" aria-label="Remove server">Remove</button>`;
  row.querySelector('.assignment-remove').addEventListener('click', () => {
    const rows = document.querySelectorAll('.assignment-row');
    if (rows.length === 1) return showToast('A client needs at least one server', 'err');
    row.remove();
  });
  document.getElementById('serverAssignments').appendChild(row);
}

function readAssignments() {
  return [...document.querySelectorAll('.assignment-row')].map(row => ({
    id: row.querySelector('.assignment-id').value || undefined,
    name: row.querySelector('.assignment-name').value.trim(),
    serverId: row.querySelector('.assignment-server').value.trim(),
    expiresAt: row.querySelector('.assignment-expiry').value || null,
  }));
}
