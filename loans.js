const express = require('express');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const router  = express.Router();

// Calculate EMI
const calcEMI = (principal, rate, months) => {
  const r = rate / 12 / 100;
  return +(principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1)).toFixed(2);
};

// ── GET /api/loans ────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM loan_accounts WHERE user_id=? ORDER BY created_at DESC', [req.user.id]);
  res.json(rows);
});

// ── POST /api/loans/apply ─────────────────────────────────────
router.post('/apply', auth, async (req, res) => {
  const { loan_type, amount, tenure_months, interest_rate } = req.body;
  if (!loan_type || !amount || !tenure_months)
    return res.status(400).json({ error: 'Loan type, amount and tenure required' });

  const rate = interest_rate || 10.50;
  const emi  = calcEMI(amount, rate, tenure_months);
  const nextEmi = new Date();
  nextEmi.setMonth(nextEmi.getMonth() + 1);

  try {
    await db.query(
      `INSERT INTO loan_accounts
       (user_id,loan_type,principal,outstanding,interest_rate,tenure_months,emi,next_emi_date)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, loan_type, amount, amount, rate, tenure_months, emi,
       nextEmi.toISOString().slice(0, 10)]
    );
    // EMI due alert
    await db.query(
      'INSERT INTO alerts (user_id,type,message,severity) VALUES (?,?,?,?)',
      [req.user.id, 'emi_due',
       `Loan approved! First EMI of ₹${emi} due on ${nextEmi.toDateString()}.`, 'medium']
    );
    res.status(201).json({ message: 'Loan applied successfully', emi });
  } catch (err) {
    res.status(500).json({ error: 'Loan application failed' });
  }
});

// ── POST /api/loans/:id/pay-emi ───────────────────────────────
router.post('/:id/pay-emi', auth, async (req, res) => {
  const { account_id } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [loan] = await conn.query(
      'SELECT * FROM loan_accounts WHERE id=? AND user_id=? AND status="active"',
      [req.params.id, req.user.id]
    );
    if (!loan.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Loan not found' });
    }

    const [acc] = await conn.query(
      'SELECT * FROM accounts WHERE id=? AND user_id=?', [account_id, req.user.id]);
    if (!acc.length || parseFloat(acc[0].balance) < parseFloat(loan[0].emi)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Insufficient balance for EMI' });
    }

    const newBalance     = parseFloat(acc[0].balance) - parseFloat(loan[0].emi);
    const newOutstanding = parseFloat(loan[0].outstanding) - parseFloat(loan[0].emi);
    const nextDate       = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);

    await conn.query('UPDATE accounts SET balance=? WHERE id=?', [newBalance, account_id]);
    await conn.query(
      'UPDATE loan_accounts SET outstanding=?, next_emi_date=?, status=? WHERE id=?',
      [Math.max(0, newOutstanding), nextDate.toISOString().slice(0, 10),
       newOutstanding <= 0 ? 'closed' : 'active', req.params.id]
    );

    const refNo = `EMI${Date.now()}`;
    await conn.query(
      `INSERT INTO transactions
       (user_id,account_id,type,amount,balance_after,reference_no,description,status)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, account_id, 'emi', loan[0].emi, newBalance, refNo,
       `Loan EMI payment - Loan #${req.params.id}`, 'completed']
    );

    await conn.commit();
    res.json({
      message:        'EMI paid successfully',
      new_outstanding: Math.max(0, newOutstanding),
      loan_status:    newOutstanding <= 0 ? 'closed' : 'active',
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'EMI payment failed' });
  } finally {
    conn.release();
  }
});

module.exports = router;
