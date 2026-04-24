const express = require('express');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const router  = express.Router();

router.get('/', auth, async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM fixed_deposits WHERE user_id=? ORDER BY created_at DESC', [req.user.id]);
  res.json(rows);
});

router.post('/create', auth, async (req, res) => {
  const { account_id, amount, duration_months, interest_rate } = req.body;
  if (!amount || !duration_months)
    return res.status(400).json({ error: 'Amount and duration required' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Deduct from account
    const [acc] = await conn.query(
      'SELECT * FROM accounts WHERE id=? AND user_id=?', [account_id, req.user.id]);
    if (!acc.length || parseFloat(acc[0].balance) < parseFloat(amount)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const rate           = interest_rate || 7.50;
    const maturityAmount = amount * (1 + (rate / 100) * (duration_months / 12));
    const startDate      = new Date();
    const maturityDate   = new Date();
    maturityDate.setMonth(maturityDate.getMonth() + parseInt(duration_months));

    await conn.query('UPDATE accounts SET balance=balance-? WHERE id=?', [amount, account_id]);
    await conn.query(
      `INSERT INTO fixed_deposits
       (user_id,amount,interest_rate,duration_months,maturity_amount,start_date,maturity_date)
       VALUES (?,?,?,?,?,?,?)`,
      [req.user.id, amount, rate, duration_months, maturityAmount.toFixed(2),
       startDate.toISOString().slice(0, 10), maturityDate.toISOString().slice(0, 10)]
    );

    await conn.commit();
    res.status(201).json({
      message:         'Fixed deposit created',
      maturity_amount: maturityAmount.toFixed(2),
      maturity_date:   maturityDate.toISOString().slice(0, 10),
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'FD creation failed' });
  } finally { conn.release(); }
});

module.exports = router;
