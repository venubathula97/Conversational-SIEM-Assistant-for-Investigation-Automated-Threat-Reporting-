// analytics.js
const express = require('express');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const router  = express.Router();

router.get('/spending', auth, async (req, res) => {
  const [monthly] = await db.query(
    `SELECT DATE_FORMAT(created_at,'%Y-%m') as month,
            SUM(CASE WHEN type IN ('withdraw','transfer','emi') THEN amount ELSE 0 END) as spent,
            SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END) as received
     FROM transactions WHERE user_id=? AND created_at > NOW() - INTERVAL 6 MONTH
     GROUP BY month ORDER BY month`,
    [req.user.id]);
  res.json(monthly);
});

router.get('/summary', auth, async (req, res) => {
  const [[totals]] = await db.query(
    `SELECT
       SUM(CASE WHEN type='deposit'                         THEN amount ELSE 0 END) as total_in,
       SUM(CASE WHEN type IN ('withdraw','transfer','emi') THEN amount ELSE 0 END) as total_out,
       COUNT(*) as total_txns,
       MAX(amount) as max_txn
     FROM transactions WHERE user_id=?`,
    [req.user.id]);
  res.json(totals);
});

module.exports = router;
