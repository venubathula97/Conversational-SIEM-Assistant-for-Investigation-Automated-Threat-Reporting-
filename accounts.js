const express = require('express');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const router  = express.Router();

// ── GET /api/accounts/summary ─────────────────────────────────
router.get('/summary', auth, async (req, res) => {
  try {
    const [accounts]  = await db.query(
      'SELECT * FROM accounts WHERE user_id=?', [req.user.id]);
    const [savings]   = await db.query(
      'SELECT * FROM savings_accounts WHERE user_id=?', [req.user.id]);
    const [fds]       = await db.query(
      'SELECT * FROM fixed_deposits WHERE user_id=? AND status="active"', [req.user.id]);
    const [loans]     = await db.query(
      'SELECT * FROM loan_accounts WHERE user_id=? AND status="active"', [req.user.id]);
    const [credits]   = await db.query(
      'SELECT * FROM credit_cards WHERE user_id=? AND status="active"', [req.user.id]);

    const totalBalance = accounts.reduce((s, a) => s + parseFloat(a.balance), 0);

    res.json({
      total_balance: totalBalance,
      accounts,
      savings:       savings[0] || null,
      fixed_deposits: fds,
      loans,
      credits,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

module.exports = router;
