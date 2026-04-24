const token = localStorage.getItem('token');

if (!token) {
  window.location.href = '/index.html';
}
requireAuth();
// ── NexaBank Dashboard JS ──────────────────────────────────────
if (!requireAuth('customer')) { /* redirected */ }

let accountsData = [];
let spendingChart = null, creditChart = null, analyticsChart = null;

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const user = api.getUser();
  document.getElementById('sidebar-name').textContent  = user.name;
  document.getElementById('sidebar-avatar').textContent = user.name[0].toUpperCase();
  document.getElementById('topbar-greeting').textContent = `Hello, ${user.name.split(' ')[0]}`;

  await Promise.all([loadSummary(), loadRecentTransactions(), loadAlertCount()]);
  populateAccountSelects();
});

// ── Section Navigation ─────────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('[id^="section-"]').forEach(el => el.classList.add('hidden'));
  document.getElementById(`section-${name}`).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const titles = { dashboard:'Dashboard', transactions:'Transactions', loans:'Loans & EMI',
    deposits:'Fixed Deposits', credit:'Credit Cards', beneficiaries:'Beneficiaries',
    alerts:'Alerts', analytics:'Analytics', profile:'Profile' };
  document.getElementById('page-title').textContent = titles[name] || name;

  if (name === 'transactions')  loadTransactions();
  if (name === 'loans')         loadLoans();
  if (name === 'deposits')      loadFDs();
  if (name === 'credit')        loadCredits();
  if (name === 'beneficiaries') loadBeneficiaries();
  if (name === 'alerts')        loadAlerts();
  if (name === 'analytics')     loadAnalytics();
  if (name === 'profile')       loadProfile();
}

// ── Modal Helpers ──────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
});

// ── Load Summary ───────────────────────────────────────────────
async function loadSummary() {
  try {
    const data = await api.get('/accounts/summary');
    accountsData = data.accounts || [];

    document.getElementById('hero-balance').textContent = fmt.currency(data.total_balance);
    document.getElementById('hero-accounts').textContent =
      `${accountsData.length} account(s) · Last updated just now`;

    // Savings
    const sav = data.savings;
    document.getElementById('savings-bal').textContent  = sav ? fmt.currency(sav.balance) : '—';
    document.getElementById('savings-rate').textContent = sav ? `${sav.interest_rate}% p.a.` : '—';

    // Current
    const cur = accountsData.find(a => a.type === 'current');
    document.getElementById('current-bal').textContent = cur ? fmt.currency(cur.balance) : '₹0.00';

    // FDs
    const fds = data.fixed_deposits || [];
    const fdTotal = fds.reduce((s, f) => s + parseFloat(f.amount), 0);
    document.getElementById('fd-total').textContent = fmt.currency(fdTotal);
    document.getElementById('fd-count').textContent = `${fds.length} active FD(s)`;

    // Loans
    const loans = data.loans || [];
    const loanTotal = loans.reduce((s, l) => s + parseFloat(l.outstanding), 0);
    document.getElementById('loan-total').textContent = fmt.currency(loanTotal);
    if (loans[0]) document.getElementById('loan-emi').textContent = `EMI: ${fmt.currency(loans[0].emi)}`;

    // Credit Doughnut
    const cc = data.credits && data.credits[0];
    if (cc) {
      const used  = parseFloat(cc.used_amount);
      const limit = parseFloat(cc.limit_amount);
      const pct   = ((used / limit) * 100).toFixed(1);
      document.getElementById('credit-pct').textContent   = pct + '%';
      document.getElementById('credit-used').textContent  = fmt.currency(used);
      document.getElementById('credit-avail').textContent = fmt.currency(limit - used);
      document.getElementById('credit-limit').textContent = fmt.currency(limit);
      renderCreditChart(used, limit - used);
    }

    renderSpendingChart();
  } catch (err) {
    showToast('Error', 'Failed to load account summary', 'error');
  }
}

// ── Charts ─────────────────────────────────────────────────────
async function renderSpendingChart() {
  try {
    const data = await api.get('/analytics/spending');
    const labels = data.map(d => d.month);
    const spent  = data.map(d => parseFloat(d.spent || 0));
    const earned = data.map(d => parseFloat(d.received || 0));

    if (spendingChart) spendingChart.destroy();
    const ctx = document.getElementById('spending-chart').getContext('2d');
    spendingChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Income',   data: earned, backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4 },
          { label: 'Expenses', data: spent,  backgroundColor: 'rgba(239,68,68,0.7)',  borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#8899bb', font: { family: 'DM Sans' } } } },
        scales: {
          x: { ticks: { color: '#4a5c7a' }, grid: { color: '#1e2d47' } },
          y: { ticks: { color: '#4a5c7a', callback: v => '₹' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#1e2d47' } },
        },
      },
    });
  } catch (_) {}
}

function renderCreditChart(used, available) {
  if (creditChart) creditChart.destroy();
  const ctx = document.getElementById('credit-chart').getContext('2d');
  creditChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [used, available],
        backgroundColor: ['rgba(245,158,11,0.85)', 'rgba(30,45,71,0.5)'],
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      cutout: '72%',
      plugins: { legend: { display: false } },
    },
  });
}

// ── Recent Transactions ────────────────────────────────────────
async function loadRecentTransactions() {
  try {
    const txns = await api.get('/transactions/history?limit=10');
    const tbody = document.getElementById('recent-txn-body');
    if (!txns.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No transactions yet</td></tr>';
      return;
    }
    tbody.innerHTML = txns.map(t => `
      <tr class="${t.is_suspicious ? 'highlight' : ''}">
        <td>${fmt.date(t.created_at)}</td>
        <td>${t.description || '—'}</td>
        <td>${fmt.txnIcon(t.type)} ${t.type}</td>
        <td style="color:${t.type==='deposit'?'var(--accent-green)':'var(--accent-red)'}">
          ${t.type==='deposit'?'+':'-'}${fmt.currency(t.amount)}
        </td>
        <td><span class="badge badge-${statusColor(t.status)}">${t.status}</span></td>
      </tr>`).join('');
  } catch (_) {}
}

// ── All Transactions ───────────────────────────────────────────
async function loadTransactions() {
  const type   = document.getElementById('txn-filter-type').value;
  const status = document.getElementById('txn-filter-status').value;
  let url = '/transactions/history?limit=100';
  if (type)   url += `&type=${type}`;
  if (status) url += `&status=${status}`;
  try {
    const txns = await api.get(url);
    const tbody = document.getElementById('all-txn-body');
    if (!txns.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No transactions found</td></tr>';
      return;
    }
    tbody.innerHTML = txns.map(t => `
      <tr class="${t.is_suspicious ? 'highlight' : ''}">
        <td style="font-family:monospace;font-size:0.75rem;color:var(--text-muted)">${t.reference_no || '—'}</td>
        <td>${fmt.datetime(t.created_at)}</td>
        <td>${t.description || '—'}</td>
        <td>${fmt.txnIcon(t.type)} ${t.type}</td>
        <td style="color:${t.type==='deposit'?'var(--accent-green)':'var(--accent-red)'}">
          ${t.type==='deposit'?'+':'-'}${fmt.currency(t.amount)}
        </td>
        <td>${t.balance_after != null ? fmt.currency(t.balance_after) : '—'}</td>
        <td><span class="badge badge-${statusColor(t.status)}">${t.status}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="risk-bar risk-${riskClass(t.risk_score)}">
              <div class="risk-fill" style="width:${t.risk_score}%"></div>
            </div>
            <span style="font-size:0.72rem;color:var(--text-muted)">${t.risk_score}</span>
          </div>
        </td>
      </tr>`).join('');
  } catch (_) {}
}

// ── Loans ──────────────────────────────────────────────────────
async function loadLoans() {
  try {
    const loans = await api.get('/loans');
    const grid  = document.getElementById('loans-grid');
    if (!loans.length) {
      grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No active loans. <a href="#" onclick="openModal(\'loan-modal\')" style="color:var(--accent-blue)">Apply for a loan →</a></div>';
      return;
    }
    grid.innerHTML = loans.map(l => {
      const progress = ((l.principal - l.outstanding) / l.principal * 100).toFixed(1);
      return `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <div>
              <div style="font-family:var(--font-display);font-weight:700;text-transform:capitalize">${l.loan_type} Loan</div>
              <div style="color:var(--text-muted);font-size:0.8rem">${l.tenure_months} months · ${l.interest_rate}% p.a.</div>
            </div>
            <span class="badge badge-${l.status==='active'?'success':'neutral'}">${l.status}</span>
          </div>
          <div class="grid-2" style="margin-bottom:16px">
            <div><div class="metric-label">Principal</div><div style="font-weight:600">${fmt.currency(l.principal)}</div></div>
            <div><div class="metric-label">Outstanding</div><div style="font-weight:600;color:var(--accent-orange)">${fmt.currency(l.outstanding)}</div></div>
            <div><div class="metric-label">Monthly EMI</div><div style="font-weight:600;color:var(--accent-blue)">${fmt.currency(l.emi)}</div></div>
            <div><div class="metric-label">Next EMI</div><div style="font-weight:600">${l.next_emi_date ? fmt.date(l.next_emi_date) : '—'}</div></div>
          </div>
          <div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:4px">
              <span style="color:var(--text-muted)">Repaid</span><span>${progress}%</span>
            </div>
            <div class="risk-bar" style="height:8px">
              <div class="risk-fill" style="width:${progress}%;background:var(--accent-green)"></div>
            </div>
          </div>
          ${l.status==='active' ? `<button class="btn btn-primary btn-sm w-full mt-1" onclick="payEMI(${l.id})">Pay EMI Now</button>` : ''}
        </div>`;
    }).join('');
  } catch (_) {}
}

async function payEMI(loanId) {
  if (!accountsData.length) return showToast('Error', 'No accounts found', 'error');
  const accId = accountsData[0].id;
  try {
    const res = await api.post(`/loans/${loanId}/pay-emi`, { account_id: accId });
    showToast('EMI Paid!', `Outstanding: ${fmt.currency(res.new_outstanding)}`, 'success');
    loadLoans();
    loadSummary();
  } catch (err) {
    showToast('Failed', err.message, 'error');
  }
}

// ── Fixed Deposits ─────────────────────────────────────────────
async function loadFDs() {
  try {
    const fds  = await api.get('/deposits');
    const grid = document.getElementById('fd-grid');
    if (!fds.length) {
      grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No fixed deposits. <a href="#" onclick="openModal(\'fd-modal\')" style="color:var(--accent-blue)">Create one →</a></div>';
      return;
    }
    grid.innerHTML = fds.map(fd => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <div style="font-family:var(--font-display);font-weight:700">Fixed Deposit</div>
          <span class="badge badge-${fd.status==='active'?'success':'neutral'}">${fd.status}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:0.875rem">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Principal</span><strong>${fmt.currency(fd.amount)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Maturity</span><strong style="color:var(--accent-green)">${fmt.currency(fd.maturity_amount)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Rate</span><span>${fd.interest_rate}% p.a.</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Duration</span><span>${fd.duration_months} months</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Matures On</span><span>${fmt.date(fd.maturity_date)}</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Gain</span><span style="color:var(--accent-cyan)">+${fmt.currency(fd.maturity_amount - fd.amount)}</span></div>
        </div>
      </div>`).join('');
  } catch (_) {}
}

// ── Credits ────────────────────────────────────────────────────
async function loadCredits() {
  try {
    const cards = await api.get('/credits');
    const grid  = document.getElementById('credit-grid');
    grid.innerHTML = cards.map(c => {
      const pct = ((c.used_amount / c.limit_amount) * 100).toFixed(1);
      return `
        <div class="card" style="background:linear-gradient(135deg,#0d1a2e,#071830);border-color:#1e3a5f">
          <div style="display:flex;justify-content:space-between;margin-bottom:20px">
            <div style="font-family:var(--font-display);font-size:1.1rem;font-weight:700">NexaBank Credit</div>
            <span class="badge badge-${c.status==='active'?'success':'danger'}">${c.status}</span>
          </div>
          <div style="font-family:monospace;font-size:1.1rem;letter-spacing:2px;margin-bottom:20px;color:var(--text-secondary)">${c.card_number}</div>
          <div class="grid-2" style="gap:12px;font-size:0.85rem;margin-bottom:16px">
            <div><div class="metric-label">Credit Limit</div><div style="font-weight:700">${fmt.currency(c.limit_amount)}</div></div>
            <div><div class="metric-label">Used</div><div style="font-weight:700;color:var(--accent-orange)">${fmt.currency(c.used_amount)}</div></div>
            <div><div class="metric-label">Available</div><div style="font-weight:700;color:var(--accent-green)">${fmt.currency(c.limit_amount - c.used_amount)}</div></div>
            <div><div class="metric-label">Due Date</div><div style="font-weight:700">${c.due_date ? fmt.date(c.due_date) : '—'}</div></div>
          </div>
          <div class="risk-bar" style="height:8px;margin-bottom:6px">
            <div class="risk-fill" style="width:${pct}%;background:${pct>80?'var(--accent-red)':pct>50?'var(--accent-orange)':'var(--accent-green)'}"></div>
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);text-align:right">${pct}% utilized</div>
        </div>`;
    }).join('') || '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No credit cards found</div>';
  } catch (_) {}
}

// ── Beneficiaries ──────────────────────────────────────────────
async function loadBeneficiaries() {
  try {
    const benes = await api.get('/transactions/beneficiaries');
    const grid  = document.getElementById('bene-grid');
    if (!benes.length) {
      grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No beneficiaries saved.</div>';
      return;
    }
    grid.innerHTML = benes.map(b => `
      <div class="card" style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="user-avatar">${b.name[0]}</div>
          <div>
            <div style="font-weight:600">${b.name}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">${b.bank_name || 'NexaBank'}</div>
          </div>
          ${b.is_verified ? '<span class="badge badge-success" style="margin-left:auto">✓ Verified</span>' : '<span class="badge badge-warning" style="margin-left:auto">Pending</span>'}
        </div>
        <div style="font-family:monospace;font-size:0.875rem;color:var(--text-secondary)">${b.account_number}</div>
        ${b.ifsc_code ? `<div style="font-size:0.75rem;color:var(--text-muted)">IFSC: ${b.ifsc_code}</div>` : ''}
        <button class="btn btn-ghost btn-sm mt-1" onclick="quickTransfer('${b.account_number}')">Transfer →</button>
      </div>`).join('');
  } catch (_) {}
}

function quickTransfer(accountNo) {
  document.getElementById('trans-to').value = accountNo;
  openModal('transfer-modal');
}

// ── Alerts ─────────────────────────────────────────────────────
async function loadAlerts() {
  try {
    const alerts = await api.get('/alerts');
    const list   = document.getElementById('alerts-list');
    if (!alerts.length) {
      list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted)">No alerts</div>';
      return;
    }
    const sev = { critical:'danger', high:'danger', medium:'warning', low:'info' };
    list.innerHTML = alerts.map(a => `
      <div class="card mb-1" style="${a.is_read ? 'opacity:.7' : 'border-color:var(--border-glow)'}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:flex-start;gap:12px">
            <span style="font-size:1.4rem">${alertIcon(a.type)}</span>
            <div>
              <div style="font-weight:600;font-size:0.9rem;margin-bottom:4px">${a.message}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">${fmt.datetime(a.created_at)}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <span class="badge badge-${sev[a.severity]||'neutral'}">${a.severity}</span>
            ${!a.is_read ? `<button class="btn btn-ghost btn-sm" onclick="markRead(${a.id})">✓</button>` : ''}
          </div>
        </div>
      </div>`).join('');
  } catch (_) {}
}

async function loadAlertCount() {
  try {
    const { count } = await api.get('/alerts/unread-count');
    const badge = document.getElementById('nav-alert-count');
    const dot   = document.getElementById('alert-dot');
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
      dot.style.display = 'block';
    }
  } catch (_) {}
}

async function markRead(id) {
  await api.put(`/alerts/${id}/read`);
  loadAlerts();
  loadAlertCount();
}

async function markAllRead() {
  await api.put('/alerts/read-all');
  loadAlerts();
  loadAlertCount();
}

// ── Analytics ──────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    const [summary, monthly] = await Promise.all([
      api.get('/analytics/summary'),
      api.get('/analytics/spending'),
    ]);
    document.getElementById('ana-in').textContent    = fmt.currency(summary.total_in);
    document.getElementById('ana-out').textContent   = fmt.currency(summary.total_out);
    document.getElementById('ana-count').textContent = summary.total_txns;

    if (analyticsChart) analyticsChart.destroy();
    const ctx = document.getElementById('analytics-chart').getContext('2d');
    analyticsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: monthly.map(d => d.month),
        datasets: [
          { label: 'Income',   data: monthly.map(d => d.received), borderColor: '#10b981', fill: false, tension: 0.4 },
          { label: 'Expenses', data: monthly.map(d => d.spent),    borderColor: '#ef4444', fill: false, tension: 0.4 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#8899bb' } } },
        scales: {
          x: { ticks: { color: '#4a5c7a' }, grid: { color: '#1e2d47' } },
          y: { ticks: { color: '#4a5c7a', callback: v => '₹' + (v/1000).toFixed(0)+'k' }, grid: { color: '#1e2d47' } },
        },
      },
    });
  } catch (_) {}
}

// ── Profile ────────────────────────────────────────────────────
async function loadProfile() {
  try {
    const user = await api.get('/auth/me');
    document.getElementById('prof-name').value    = user.name;
    document.getElementById('prof-email').value   = user.email;
    document.getElementById('prof-phone').value   = user.phone || '';
    document.getElementById('prof-address').value = user.address || '';
  } catch (_) {}
}

async function saveProfile(e) {
  e.preventDefault();
  try {
    await api.put('/auth/profile', {
      name:    document.getElementById('prof-name').value,
      phone:   document.getElementById('prof-phone').value,
      address: document.getElementById('prof-address').value,
    });
    showToast('Saved!', 'Profile updated successfully', 'success');
  } catch (err) { showToast('Error', err.message, 'error'); }
}

async function changePassword(e) {
  e.preventDefault();
  const newPass = document.getElementById('new-pass').value;
  const conPass = document.getElementById('con-pass').value;
  if (newPass !== conPass) return showToast('Mismatch', 'Passwords do not match', 'error');
  try {
    await api.put('/auth/change-password', {
      current_password: document.getElementById('cur-pass').value,
      new_password:     newPass,
    });
    showToast('Updated!', 'Password changed successfully', 'success');
    document.getElementById('cur-pass').value = '';
    document.getElementById('new-pass').value = '';
    document.getElementById('con-pass').value = '';
  } catch (err) { showToast('Error', err.message, 'error'); }
}

// ── Money Operations ───────────────────────────────────────────
async function doDeposit() {
  try {
    const res = await api.post('/transactions/deposit', {
      account_id:  parseInt(document.getElementById('dep-account').value),
      amount:      parseFloat(document.getElementById('dep-amount').value),
      description: document.getElementById('dep-desc').value,
    });
    closeModal('deposit-modal');
    showToast('Deposited!', `Ref: ${res.reference_no}. Balance: ${fmt.currency(res.new_balance)}`, 'success');
    if (res.risk_score > 50) showToast('Fraud Alert', `Risk score: ${res.risk_score}/100`, 'warning');
    loadSummary(); loadRecentTransactions(); loadAlertCount();
  } catch (err) { showToast('Failed', err.message, 'error'); }
}

async function doWithdraw() {
  try {
    const res = await api.post('/transactions/withdraw', {
      account_id:  parseInt(document.getElementById('with-account').value),
      amount:      parseFloat(document.getElementById('with-amount').value),
      description: document.getElementById('with-desc').value,
    });
    closeModal('withdraw-modal');
    showToast('Withdrawn!', `Ref: ${res.reference_no}. Balance: ${fmt.currency(res.new_balance)}`, 'success');
    loadSummary(); loadRecentTransactions();
  } catch (err) { showToast('Failed', err.message, 'error'); }
}

async function doTransfer() {
  try {
    const res = await api.post('/transactions/transfer', {
      from_account_id: parseInt(document.getElementById('trans-from').value),
      to_account_no:   document.getElementById('trans-to').value.trim(),
      amount:          parseFloat(document.getElementById('trans-amount').value),
      description:     document.getElementById('trans-desc').value,
    });
    closeModal('transfer-modal');
    const msg = res.flagged ? '⚠️ Flagged for review' : 'Transfer successful!';
    showToast(msg, `Ref: ${res.reference_no}`, res.flagged ? 'warning' : 'success');
    loadSummary(); loadRecentTransactions();
  } catch (err) { showToast('Failed', err.message, 'error'); }
}

function calcEMIPreview() {
  const p = parseFloat(document.getElementById('loan-amount').value) || 0;
  const r = (parseFloat(document.getElementById('loan-rate').value) || 10.5) / 12 / 100;
  const n = parseInt(document.getElementById('loan-tenure').value) || 1;
  const emi = p * r * Math.pow(1+r,n) / (Math.pow(1+r,n) - 1);
  document.getElementById('emi-val').textContent = fmt.currency(emi.toFixed(2));
  document.getElementById('emi-preview').style.display = 'block';
}

async function applyLoan() {
  try {
    const res = await api.post('/loans/apply', {
      loan_type:      document.getElementById('loan-type').value,
      amount:         parseFloat(document.getElementById('loan-amount').value),
      tenure_months:  parseInt(document.getElementById('loan-tenure').value),
      interest_rate:  parseFloat(document.getElementById('loan-rate').value),
    });
    closeModal('loan-modal');
    showToast('Loan Approved!', `Monthly EMI: ${fmt.currency(res.emi)}`, 'success');
    loadLoans();
  } catch (err) { showToast('Failed', err.message, 'error'); }
}

async function createFD() {
  try {
    const res = await api.post('/deposits/create', {
      account_id:      parseInt(document.getElementById('fd-account').value),
      amount:          parseFloat(document.getElementById('fd-amount').value),
      duration_months: parseInt(document.getElementById('fd-duration').value),
      interest_rate:   parseFloat(document.getElementById('fd-rate').value),
    });
    closeModal('fd-modal');
    showToast('FD Created!', `Matures on ${res.maturity_date} · Gain: ${fmt.currency(parseFloat(res.maturity_amount) - parseFloat(document.getElementById('fd-amount').value))}`, 'success');
    loadFDs(); loadSummary();
  } catch (err) { showToast('Failed', err.message, 'error'); }
}

async function addBeneficiary() {
  try {
    await api.post('/transactions/beneficiary', {
      name:           document.getElementById('bene-name').value,
      account_number: document.getElementById('bene-account').value,
      bank_name:      document.getElementById('bene-bank').value,
      ifsc_code:      document.getElementById('bene-ifsc').value,
    });
    closeModal('bene-modal');
    showToast('Added!', 'Beneficiary saved successfully', 'success');
    loadBeneficiaries();
  } catch (err) { showToast('Failed', err.message, 'error'); }
}

// ── Chat ───────────────────────────────────────────────────────
function toggleChat() {
  document.getElementById('chat-panel').classList.toggle('open');
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';

  const msgs = document.getElementById('chat-messages');
  msgs.innerHTML += `<div class="chat-msg user">${msg}</div>`;
  msgs.innerHTML += `<div class="chat-msg bot" id="chat-typing">⋯</div>`;
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const res = await api.post('/ai/chat', { message: msg });
    document.getElementById('chat-typing').textContent = res.reply;
  } catch (err) {
    document.getElementById('chat-typing').textContent = '❌ Could not connect to AI. Please check your API key.';
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Populate Account Selects ───────────────────────────────────
function populateAccountSelects() {
  const selects = ['dep-account','with-account','trans-from','fd-account'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = accountsData.map(a =>
      `<option value="${a.id}">${a.type.charAt(0).toUpperCase()+a.type.slice(1)} — ${a.account_no} (${fmt.currency(a.balance)})</option>`
    ).join('');
  });
}

// ── Utils ──────────────────────────────────────────────────────
function statusColor(s) {
  return { completed:'success', flagged:'danger', failed:'danger', pending:'warning' }[s] || 'neutral';
}
function riskClass(s) { return s >= 70 ? 'high' : s >= 40 ? 'medium' : 'low'; }
function alertIcon(type) {
  return { fraud:'🚨', large_txn:'💸', low_balance:'⚠️', login_anomaly:'🔐',
           emi_due:'🏠', credit_due:'💳', system:'⚙️' }[type] || '🔔';
}
