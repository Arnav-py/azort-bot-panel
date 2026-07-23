/* Azort Devs — client management logic */

let clients = [];
let adminData = { announcements: [], audit: [], settings: {}, summary: {} };
let activeAdminBot = null;

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
    const res = await fetch('/api/admin-tools');
    if (res.status === 401) {
      window.location.href = '/devs/index.html';
      return;
    }
    const data = await res.json();
    adminData = data;
    clients = data.clients || [];
    renderAdminTools();
    populateClientSelect();
    renderClients();
    return;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:30px;">Couldn't load clients.</td></tr>`;
  }
}

function renderClients() {
  const body = document.getElementById('clientsBody');
  const query = (document.getElementById('clientSearch')?.value || '').toLowerCase();
  const status = document.getElementById('statusFilter')?.value || 'all';
  const filtered = clients.filter(client => {
    const haystack = [client.username, client.displayName, ...(client.bots || []).flatMap(bot => [bot.name, bot.serverId])].join(' ').toLowerCase();
    const clientStatus = client.suspended ? 'expired' : 'active';
    return (!query || haystack.includes(query)) && (status === 'all' || status === clientStatus);
  });
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No matching clients.</td></tr>`;
    return;
  }
  body.innerHTML = filtered.map(c => `
    <tr>
      <td><strong>${c.username}</strong><div style="color:var(--text-dim);font-size:11px">${c.lastLogin ? `Last login ${fmtDate(c.lastLogin)}` : 'Never logged in'}</div></td>
      <td><div class="client-server-list">${(c.bots || []).map(bot => `
        <div class="admin-server-entry">
          <input class="server-select" type="checkbox" data-select-server="${bot.id}" aria-label="Select ${bot.name}">
          <button class="admin-server-card" data-server="${encodeURIComponent(JSON.stringify({ ...bot, clientName: c.username, clientId: c.id, note: c.notes || '' }))}">
            <span><strong>${bot.name}</strong><span>${bot.status || 'offline'} · ${bot.plan || 'Standard'}</span></span><b class="admin-server-arrow">&rarr;</b>
          </button>
        </div>`).join('') || '<span>—</span>'}</div></td>
      <td><span class="badge ${c.suspended ? 'expired' : 'active'}">${c.suspended ? 'Expired' : 'Active'}</span></td>
      <td>${fmtDate((c.bots || [])[0]?.expiresAt)}</td>
      <td>${c.notes ? '<span class="badge active">Has note</span>' : '—'}</td>
      <td><div class="row-actions"><button class="btn-ghost" data-edit="${c.id}">Edit</button><button class="btn-ghost" data-reset="${c.id}">Reset pass</button></div></td>
    </tr>`).join('');
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openModal(btn.dataset.edit)));
  body.querySelectorAll('[data-reset]').forEach(btn => btn.addEventListener('click', () => resetPassword(btn.dataset.reset)));
  body.querySelectorAll('[data-server]').forEach(btn => btn.addEventListener('click', () => openServerDetail(JSON.parse(decodeURIComponent(btn.dataset.server)))));
  body.querySelectorAll('[data-select-server]').forEach(input => input.addEventListener('click', event => event.stopPropagation()));
  updateSelectedCount();
}

function renderAdminTools() {
  const summary = adminData.summary || {};
  document.getElementById('statClients').textContent = summary.clients || 0;
  document.getElementById('statServers').textContent = summary.servers || 0;
  document.getElementById('statOnline').textContent = summary.online || 0;
  document.getElementById('statExpiring').textContent = summary.expiring || 0;
  document.getElementById('statCpu').textContent = summary.avgCpu === null || summary.avgCpu === undefined ? '—' : `${Number(summary.avgCpu).toFixed(1)}%`;
  document.getElementById('statMemory').textContent = summary.memoryUsed ? formatBytes(summary.memoryUsed) : '—';
  document.getElementById('maintenanceBtn').textContent = adminData.settings?.maintenanceMode ? 'Disable maintenance' : 'Enable maintenance';
  document.getElementById('announcementList').innerHTML = (adminData.announcements || []).map(item => `<div class="announcement-item"><div><strong>${item.title}</strong><p>${item.message}</p></div><button class="btn-ghost" data-delete-announcement="${item.id}">Delete</button></div>`).join('') || '<div class="form-note">No active announcements.</div>';
  document.querySelectorAll('[data-delete-announcement]').forEach(btn => btn.addEventListener('click', () => deleteAnnouncement(btn.dataset.deleteAnnouncement)));
  const now = Date.now();
  const expiring = clients.flatMap(client => (client.bots || []).filter(bot => bot.expiresAt && new Date(bot.expiresAt).getTime() <= now + 30 * 86400000).map(bot => ({ ...bot, username: client.username })));
  document.getElementById('expiryList').innerHTML = expiring.map(bot => `<div class="expiry-item"><strong>${bot.name}</strong><span>${bot.username} · expires ${fmtDate(bot.expiresAt)}</span></div>`).join('') || '<div class="form-note">No servers expiring in the next 30 days.</div>';
  document.getElementById('auditList').innerHTML = (adminData.audit || []).slice(0, 12).map(item => `<div class="audit-item"><strong>${item.action}</strong><span>${item.target || ''} · ${fmtDate(item.at)} · ${item.actor}</span></div>`).join('') || '<div class="form-note">No activity recorded yet.</div>';
}

function populateClientSelect() {
  document.getElementById('bulkClient').innerHTML = '<option value="">Choose a client</option>' + clients.map(client => `<option value="${client.id}">${client.username}</option>`).join('');
}

function selectedServerIds() {
  return [...document.querySelectorAll('[data-select-server]:checked')].map(input => input.dataset.selectServer);
}

function updateSelectedCount() { document.getElementById('selectedCount').textContent = selectedServerIds().length; }

async function adminPost(payload) {
  const res = await fetch('/api/admin-tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Operation failed');
  return data;
}

async function deleteAnnouncement(id) {
  try { await adminPost({ action: 'announcement-delete', id }); showToast('Announcement removed'); loadClients(); }
  catch (error) { showToast(error.message, 'err'); }
}

async function saveAnnouncement(event) {
  event.preventDefault();
  try {
    await adminPost({ action: 'announcement-create', title: document.getElementById('announcementTitle').value.trim(), message: document.getElementById('announcementMessage').value.trim(), tone: document.getElementById('announcementTone').value });
    event.target.reset(); showToast('Announcement published'); loadClients();
  } catch (error) { showToast(error.message, 'err'); }
}

async function toggleMaintenance() {
  const enabled = !adminData.settings?.maintenanceMode;
  try { await adminPost({ action: 'maintenance', enabled }); showToast(enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled'); loadClients(); }
  catch (error) { showToast(error.message, 'err'); }
}

async function saveBulkAssignment(event) {
  event.preventDefault();
  try {
    await adminPost({ action: 'bulk-assign', userId: document.getElementById('bulkClient').value, name: document.getElementById('bulkName').value.trim(), serverId: document.getElementById('bulkServerId').value.trim(), expiresAt: document.getElementById('bulkExpiry').value || null, plan: document.getElementById('bulkPlan').value });
    event.target.reset(); showToast('Server assigned'); loadClients();
  } catch (error) { showToast(error.message, 'err'); }
}

async function removeSelectedServers() {
  const botIds = selectedServerIds();
  if (!botIds.length || !confirm(`Remove ${botIds.length} selected server(s) from their clients?`)) return;
  try { await adminPost({ action: 'bulk-remove', botIds }); showToast('Selected servers removed'); loadClients(); }
  catch (error) { showToast(error.message, 'err'); }
}

function exportCsv() {
  const rows = [['Client', 'Server', 'Server ID', 'Status', 'Plan', 'Expires']];
  clients.forEach(client => (client.bots || []).forEach(bot => rows.push([client.username, bot.name, bot.serverId, bot.status || 'offline', bot.plan || 'Standard', bot.expiresAt || ''])));
  const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'azort-servers.csv'; link.click(); URL.revokeObjectURL(link.href);
}

function openServerDetail(bot) {
  activeAdminBot = bot;
  document.getElementById('adminDetailName').textContent = bot.name || 'Server';
  document.getElementById('adminDetailClient').textContent = bot.clientName || '—';
  document.getElementById('adminDetailExpiry').textContent = fmtDate(bot.expiresAt);
  document.getElementById('adminDetailId').textContent = bot.serverId || '—';
  document.getElementById('adminDetailPlan').textContent = bot.plan || 'Standard';
  document.getElementById('adminDetailCpu').textContent = bot.cpuLimit ? `${bot.cpuLimit}%` : '—';
  document.getElementById('adminDetailMemory').textContent = bot.memLimit ? `${bot.memLimit} MB` : '—';
  document.getElementById('adminDetailCpuUsed').textContent = bot.details?.cpuUsed ? `${Number(bot.details.cpuUsed).toFixed(1)}%` : '—';
  document.getElementById('adminDetailMemoryUsed').textContent = bot.details?.memoryUsed ? formatBytes(bot.details.memoryUsed) : '—';
  document.getElementById('adminDetailDiskUsed').textContent = bot.details?.diskUsed ? formatBytes(bot.details.diskUsed) : '—';
  document.getElementById('adminDetailAction').textContent = bot.lastAction || 'None yet';
  document.getElementById('adminDetailAccess').textContent = bot.status === 'suspended' ? 'Suspended' : 'Active';
  document.getElementById('adminDetailNote').value = bot.note || '';
  document.getElementById('adminDetailStatus').textContent = bot.status === 'online' ? 'Online' : bot.status === 'restarting' ? 'Restarting' : 'Offline';
  document.getElementById('adminDetailStatus').className = `status-text ${bot.status === 'online' ? 'online' : bot.status === 'restarting' ? 'restarting' : 'offline'}`;
  renderAdminPulse(bot.status);
  document.getElementById('serverDetailOverlay').classList.add('show');
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let value = bytes; let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function renderAdminPulse(status) {
  const pulse = document.getElementById('adminDetailPulse');
  pulse.className = `pulse ${status === 'online' ? '' : status === 'restarting' ? 'restarting' : 'offline'}`;
}

function closeServerDetail() {
  document.getElementById('serverDetailOverlay').classList.remove('show');
  activeAdminBot = null;
}

async function saveAdminNote() {
  if (!activeAdminBot) return;
  try { await adminPost({ action: 'client-note', userId: activeAdminBot.clientId, note: document.getElementById('adminDetailNote').value }); showToast('Internal note saved'); loadClients(); }
  catch (error) { showToast(error.message, 'err'); }
}

async function adminServerAction(power) {
  if (!activeAdminBot) return;
  try { await adminPost({ action: 'server-action', botId: activeAdminBot.id, power }); showToast(`${power[0].toUpperCase() + power.slice(1)} signal sent`); closeServerDetail(); loadClients(); }
  catch (error) { showToast(error.message, 'err'); }
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
    document.getElementById('cStatus').value = c.suspended ? 'expired' : 'active';
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
  document.getElementById('bulkAssignForm').addEventListener('submit', saveBulkAssignment);
  document.getElementById('announcementForm').addEventListener('submit', saveAnnouncement);
  document.getElementById('maintenanceBtn').addEventListener('click', toggleMaintenance);
  document.getElementById('exportBtn').addEventListener('click', exportCsv);
  document.getElementById('bulkRemoveBtn').addEventListener('click', removeSelectedServers);
  document.getElementById('clientSearch').addEventListener('input', renderClients);
  document.getElementById('statusFilter').addEventListener('change', renderClients);
  document.getElementById('clientsBody').addEventListener('change', updateSelectedCount);
  document.getElementById('adminNoteSave').addEventListener('click', saveAdminNote);
  document.getElementById('adminStartBtn').addEventListener('click', () => adminServerAction('start'));
  document.getElementById('adminRestartBtn').addEventListener('click', () => adminServerAction('restart'));
  document.getElementById('adminStopBtn').addEventListener('click', () => adminServerAction('stop'));
  document.getElementById('adminKillBtn').addEventListener('click', () => adminServerAction('kill'));
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
