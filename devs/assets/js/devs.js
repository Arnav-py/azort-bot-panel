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
        <td>
          <div>${c.botName}</div>
          <div class="mono" style="color:var(--text-dim); font-size:11.5px;">${c.serverId}</div>
        </td>
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

  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:30px;">Couldn't load clients.</td></tr>`;
  }
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
    document.getElementById('cBotName').value = c.botName;
    document.getElementById('cServerId').value = c.serverId;
    document.getElementById('cExpiry').value = c.expiresAt ? c.expiresAt.split('T')[0] : '';
    document.getElementById('cStatus').value = c.status;
    document.getElementById('tempPassWrap').style.display = 'none';
  } else {
    document.getElementById('modalTitle').textContent = 'Add client';
    document.getElementById('clientId').value = '';
    document.getElementById('tempPassWrap').style.display = 'block';
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
    botName: document.getElementById('cBotName').value.trim(),
    serverId: document.getElementById('cServerId').value.trim(),
    expiresAt: document.getElementById('cExpiry').value || null,
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
  document.getElementById('clientForm').addEventListener('submit', saveClient);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/devs-logout', { method: 'POST' });
    window.location.href = '/devs/index.html';
  });
});
