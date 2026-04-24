const express = require('express');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const role    = require('../middleware/roleMiddleware');
const router  = express.Router();

// All admin routes protected
router.use(auth, role('admin'));

// ── GET /api/admin/dashboard ──────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [[fraudTotal]]  = await db.query('SELECT COUNT(*) as c FROM fraud_logs');
    const [[highRisk]]    = await db.query(
      'SELECT COUNT(DISTINCT user_id) as c FROM fraud_logs WHERE risk_score >= 70');
    const [[openCases]]   = await db.query(
      'SELECT COUNT(*) as c FROM fraud_logs WHERE status="open"');
    const [[totalUsers]]  = await db.query('SELECT COUNT(*) as c FROM users WHERE role="customer"');
    const [[blockedUsers]]= await db.query('SELECT COUNT(*) as c FROM users WHERE is_blocked=1');
    const [[todayTxns]]   = await db.query(
      'SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as vol FROM transactions WHERE DATE(created_at)=CURDATE()');
    const [[flaggedToday]]= await db.query(
      'SELECT COUNT(*) as c FROM transactions WHERE is_suspicious=1 AND DATE(created_at)=CURDATE()');

    // Fraud trend last 7 days
    const [fraudTrend] = await db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM fraud_logs WHERE created_at > NOW() - INTERVAL 7 DAY
       GROUP BY DATE(created_at) ORDER BY date`);

    // Recent suspicious transactions
    const [recentSuspicious] = await db.query(
      `SELECT t.*, u.name, u.email FROM transactions t
       JOIN users u ON t.user_id=u.id
       WHERE t.is_suspicious=1 ORDER BY t.created_at DESC LIMIT 10`);

    res.json({
      metrics: {
        total_fraud_cases:  fraudTotal.c,
        high_risk_users:    highRisk.c,
        open_cases:         openCases.c,
        total_customers:    totalUsers.c,
        blocked_users:      blockedUsers.c,
        today_transactions: todayTxns.c,
        today_volume:       todayTxns.vol,
        flagged_today:      flaggedToday.c,
      },
      fraud_trend:          fraudTrend,
      recent_suspicious:    recentSuspicious,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Dashboard fetch failed' });
  }
});

// ── GET /api/admin/fraud-logs ─────────────────────────────────
router.get('/fraud-logs', async (req, res) => {
  const { user_id, min_risk, max_risk, status, from_date, to_date, limit = 50, offset = 0 } = req.query;
  try {
    let where = 'WHERE 1=1';
    const params = [];
    if (user_id)   { where += ' AND f.user_id=?';       params.push(user_id); }
    if (min_risk)  { where += ' AND f.risk_score>=?';   params.push(min_risk); }
    if (max_risk)  { where += ' AND f.risk_score<=?';   params.push(max_risk); }
    if (status)    { where += ' AND f.status=?';        params.push(status); }
    if (from_date) { where += ' AND DATE(f.created_at)>=?'; params.push(from_date); }
    if (to_date)   { where += ' AND DATE(f.created_at)<=?'; params.push(to_date); }

    const [rows] = await db.query(
      `SELECT f.*, u.name, u.email, t.amount, t.type as txn_type
       FROM fraud_logs f
       JOIN users u ON f.user_id=u.id
       LEFT JOIN transactions t ON f.transaction_id=t.id
       ${where} ORDER BY f.risk_score DESC, f.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fraud logs' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────
router.get('/users', async (req, res) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_blocked, u.created_at,
            COUNT(DISTINCT t.id) as txn_count,
            COALESCE(MAX(f.risk_score),0) as max_risk_score,
            COUNT(DISTINCT f.id) as fraud_count
     FROM users u
     LEFT JOIN transactions t ON u.id=t.user_id
     LEFT JOIN fraud_logs f   ON u.id=f.user_id
     WHERE u.role='customer'
     GROUP BY u.id ORDER BY max_risk_score DESC`
  );
  res.json(rows);
});

// ── GET /api/admin/users/:id/investigate ─────────────────────
router.get('/users/:id/investigate', async (req, res) => {
  try {
    const [user]     = await db.query(
      'SELECT id,name,email,phone,is_blocked,created_at FROM users WHERE id=?', [req.params.id]);
    const [accounts] = await db.query(
      'SELECT * FROM accounts WHERE user_id=?', [req.params.id]);
    const [txns]     = await db.query(
      `SELECT * FROM transactions WHERE user_id=?
       ORDER BY created_at DESC LIMIT 30`, [req.params.id]);
    const [frauds]   = await db.query(
      'SELECT * FROM fraud_logs WHERE user_id=? ORDER BY created_at DESC', [req.params.id]);
    const [logins]   = await db.query(
      'SELECT * FROM login_activity WHERE user_id=? ORDER BY timestamp DESC LIMIT 20',
      [req.params.id]);

    if (!user.length) return res.status(404).json({ error: 'User not found' });

    res.json({ user: user[0], accounts, transactions: txns, fraud_logs: frauds, login_activity: logins });
  } catch (err) {
    res.status(500).json({ error: 'Investigation failed' });
  }
});

// ── PUT /api/admin/users/:id/block ────────────────────────────
router.put('/users/:id/block', async (req, res) => {
  await db.query('UPDATE users SET is_blocked=1 WHERE id=?', [req.params.id]);
  await db.query(
    'INSERT INTO audit_logs (user_id,action,entity,entity_id,ip) VALUES (?,?,?,?,?)',
    [req.user.id, 'BLOCK_USER', 'users', req.params.id, req.ip]);
  res.json({ message: 'User blocked' });
});

// ── PUT /api/admin/users/:id/unblock ─────────────────────────
router.put('/users/:id/unblock', async (req, res) => {
  await db.query('UPDATE users SET is_blocked=0 WHERE id=?', [req.params.id]);
  await db.query(
    'INSERT INTO audit_logs (user_id,action,entity,entity_id,ip) VALUES (?,?,?,?,?)',
    [req.user.id, 'UNBLOCK_USER', 'users', req.params.id, req.ip]);
  res.json({ message: 'User unblocked' });
});

// ── PUT /api/admin/accounts/:id/freeze ───────────────────────
router.put('/accounts/:id/freeze', async (req, res) => {
  await db.query('UPDATE accounts SET is_frozen=1 WHERE id=?', [req.params.id]);
  await db.query(
    'INSERT INTO audit_logs (user_id,action,entity,entity_id,ip) VALUES (?,?,?,?,?)',
    [req.user.id, 'FREEZE_ACCOUNT', 'accounts', req.params.id, req.ip]);
  res.json({ message: 'Account frozen' });
});

// ── PUT /api/admin/accounts/:id/unfreeze ─────────────────────
router.put('/accounts/:id/unfreeze', async (req, res) => {
  await db.query('UPDATE accounts SET is_frozen=0 WHERE id=?', [req.params.id]);
  res.json({ message: 'Account unfrozen' });
});

// ── PUT /api/admin/transactions/:id/safe ─────────────────────
router.put('/transactions/:id/safe', async (req, res) => {
  await db.query(
    'UPDATE transactions SET status="completed", is_suspicious=0 WHERE id=?',
    [req.params.id]);
  await db.query(
    'UPDATE fraud_logs SET status="false_positive" WHERE transaction_id=?',
    [req.params.id]);
  await db.query(
    'INSERT INTO audit_logs (user_id,action,entity,entity_id,ip) VALUES (?,?,?,?,?)',
    [req.user.id, 'MARK_SAFE', 'transactions', req.params.id, req.ip]);
  res.json({ message: 'Transaction marked as safe' });
});

// ── PUT /api/admin/fraud-logs/:id/status ─────────────────────
router.put('/fraud-logs/:id/status', async (req, res) => {
  const { status } = req.body;
  await db.query(
    'UPDATE fraud_logs SET status=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
    [status, req.user.id, req.params.id]);
  res.json({ message: 'Fraud log updated' });
});

// ── GET /api/admin/realtime-logs ──────────────────────────────
router.get('/realtime-logs', async (req, res) => {
  try {
    const [txns] = await db.query(
      `SELECT t.*, u.name, u.email FROM transactions t
       JOIN users u ON t.user_id=u.id
       ORDER BY t.created_at DESC LIMIT 20`);
    const [logins] = await db.query(
      `SELECT l.*, u.name, u.email FROM login_activity l
       JOIN users u ON l.user_id=u.id
       ORDER BY l.timestamp DESC LIMIT 10`);
    const [alerts] = await db.query(
      `SELECT a.*, u.name FROM alerts a
       JOIN users u ON a.user_id=u.id
       ORDER BY a.created_at DESC LIMIT 10`);
    res.json({ transactions: txns, logins, alerts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ── GET /api/admin/audit-logs ────────────────────────────────
router.get('/audit-logs', async (req, res) => {
  const [rows] = await db.query(
    `SELECT al.*, u.name FROM audit_logs al
     LEFT JOIN users u ON al.user_id=u.id
     ORDER BY al.created_at DESC LIMIT 100`);
  res.json(rows);
});

// ── GET /api/admin/all-transactions ──────────────────────────
router.get('/all-transactions', async (req, res) => {
  const { status, is_suspicious, limit = 50, offset = 0 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (status)       { where += ' AND t.status=?';         params.push(status); }
  if (is_suspicious){ where += ' AND t.is_suspicious=1';  }

  const [rows] = await db.query(
    `SELECT t.*, u.name, u.email FROM transactions t
     JOIN users u ON t.user_id=u.id
     ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), parseInt(offset)]
  );
  res.json(rows);
});

module.exports = router;
