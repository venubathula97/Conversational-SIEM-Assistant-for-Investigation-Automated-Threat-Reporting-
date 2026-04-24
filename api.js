// ── NexaBank API Helper ────────────────────────────────────────
const API_BASE = 'http://localhost:5000/api';

const api = {
  getToken: ()  => localStorage.getItem('token'),
  getUser:  ()  => JSON.parse(localStorage.getItem('user') || 'null'),
  setAuth:  (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user',  JSON.stringify(user));
  },
  clearAuth: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  request: async (method, path, data = null) => {
    const token = api.getToken();
    const opts  = {
      method,
      headers: {
        'Content-Type':  'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    };
    if (data && method !== 'GET') opts.body = JSON.stringify(data);

    const res = await fetch(`${API_BASE}${path}`, opts);
    const json = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  },

  get:    (path)       => api.request('GET',    path),
  post:   (path, data) => api.request('POST',   path, data),
  put:    (path, data) => api.request('PUT',    path, data),
  delete: (path)       => api.request('DELETE', path),
};

// ── Toast Notifications ────────────────────────────────────────
function showToast(title, message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span style="font-size:1.1rem">${icons[type]}</span>
    <div>
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
    <span style="margin-left:auto;cursor:pointer;color:var(--text-muted)" onclick="this.closest('.toast').remove()">✕</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── Format Helpers ─────────────────────────────────────────────
const fmt = {
  currency: (n) => '₹' + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  date:     (d) => new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }),
  datetime: (d) => new Date(d).toLocaleString('en-IN',  { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }),
  percent:  (n) => parseFloat(n || 0).toFixed(2) + '%',
  riskColor:(s) => s >= 70 ? 'danger' : s >= 40 ? 'warning' : 'success',
  txnIcon:  (t) => ({ deposit:'⬇️', withdraw:'⬆️', transfer:'↔️', emi:'🏠', credit_payment:'💳' }[t] || '💰'),
};

// ── Guard: require login ───────────────────────────────────────
function requireAuth(requiredRole = null) {
  const token = api.getToken();
  const user  = api.getUser();
  if (!token || !user) {
    window.location.href = '../index.html';
    return false;
  }
  if (requiredRole && user.role !== requiredRole) {
    window.location.href = user.role === 'admin' ? 'admin.html' : 'dashboard.html';
    return false;
  }
  return true;
}

// ── Logout ─────────────────────────────────────────────────────
window.logout = function () {
  localStorage.removeItem('token');
  localStorage.removeItem('user');

  // ✅ redirect to login page
  window.location.href = '/';
};