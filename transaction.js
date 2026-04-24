const express = require('express');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const router  = express.Router();

// ── Fraud Detection Engine ────────────────────────────────────
const detectFraud = async (userId, amount, location, ip) => {
  let riskScore = 0;
  const reasons = [];

  // Rule 1: Large amount
  if (amount > 50000) {
    riskScore += 30;
    reasons.push('LARGE_AMOUNT');
  }
  // Rule 2: Night transaction (10 PM - 5 AM IST)
  const hour = new Date().getHours();
  if (hour >= 22 || hour <= 5) {
    riskScore += 20;
    reasons.push('NIGHT_TRANSACTION');
  }
  // Rule 3: Unusual IP (not matching typical pattern)
  if (ip && !ip.startsWith('192.168') && !ip.startsWith('10.')) {
    riskScore += 15;
    reasons.push('UNUSUAL_IP');
  }
  // Rule 4: Rapid transactions (5+ in last 10 mins)
  const [rapid] = await db.query(
    `SELECT COUNT(*) as cnt FROM transactions
     WHERE user_id=? AND created_at > NOW() - INTERVAL 10 MINUTE`,
    [userId]
  );
  if (rapid[0].cnt >= 5) {
    riskScore += 25;
    reasons.push('RAPID_TRANSACTIONS');
  }
  // Rule 5: Unusual location
  if (location && ['Russia','Unknown','Tor','Proxy'].some(x =>
    location.toLowerCase().includes(x.toLowerCase()))) {
    riskScore += 30;
    reasons.push('UNUSUAL_LOCATION');
  }
  // Rule 6: Amount much higher than average
  const [avgRow] = await db.query(
    `SELECT AVG(amount) as avg_amt FROM transactions
     WHERE user_id=? AND created_at > NOW() - INTERVAL 30 DAY`,
    [userId]
  );
  if (avgRow[0].avg_amt && amount > avgRow[0].avg_amt * 5) {
    riskScore += 20;
    reasons.push('ABNORMAL_SPENDING_PATTERN');
  }

  riskScore = Math.min(riskScore, 100);

  // Call ML Service if available
  let mlPrediction = false;
  try {
    const mlRes = await axios.post(
      `${process.env.ML_SERVICE_URL || 'http://localhost:5001'}/predict`,
      { amount, hour, frequency: rapid[0].cnt, location: location || 'Unknown' },
      { timeout: 2000 }
    );
    mlPrediction = mlRes.data.fraud;
    if (mlPrediction) {
      riskScore = Math.min(riskScore + 15, 100);
      reasons.push('ML_FLAGGED');
    }
  } catch (_) { /* ML service unavailable */ }

  return { riskScore, reasons: reasons.join(','), mlPrediction, isSuspicious: riskScore >= 50 };
};

// ── POST /api/transactions/deposit ───────────────────────────
router.post('/deposit', auth, async (req, res) => {
  const { account_id, amount, description } = req.body;
  if (!account_id || !amount || amount <= 0)
    return res.status(400).json({ error: 'Invalid deposit data' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [acc] = await conn.query(
      'SELECT * FROM accounts WHERE id=? AND user_id=? AND is_frozen=0',
      [account_id, req.user.id]
    );
    if (!acc.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Account not found or frozen' });
    }

    const newBalance = parseFloat(acc[0].balance) + parseFloat(amount);
    await conn.query('UPDATE accounts SET balance=? WHERE id=?', [newBalance, account_id]);

    const refNo = `NX${Date.now()}`;
    const fraud = await detectFraud(req.user.id, amount, 'Local', req.ip);

    const [txnResult] = await conn.query(
      `INSERT INTO transactions
       (user_id,account_id,type,amount,balance_after,reference_no,description,status,ip_address,risk_score,is_suspicious)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, account_id, 'deposit', amount, newBalance, refNo,
       description || 'Deposit', 'completed', req.ip, fraud.riskScore, fraud.isSuspicious ? 1 : 0]
    );

    if (fraud.isSuspicious) {
      await conn.query(
        'INSERT INTO fraud_logs (user_id,transaction_id,risk_score,reason,ml_prediction,rule_triggered) VALUES (?,?,?,?,?,?)',
        [req.user.id, txnResult.insertId, fraud.riskScore,
         `Suspicious deposit detected: ${fraud.reasons}`, fraud.mlPrediction ? 1 : 0, fraud.reasons]
      );
      await conn.query(
        'INSERT INTO alerts (user_id,type,message,severity) VALUES (?,?,?,?)',
        [req.user.id, 'fraud', `Suspicious deposit of ₹${amount} detected. Risk: ${fraud.riskScore}/100`, 'high']
      );
    }

    // Large transaction alert
    if (amount > 50000) {
      await conn.query(
        'INSERT INTO alerts (user_id,type,message,severity) VALUES (?,?,?,?)',
        [req.user.id, 'large_txn', `Large deposit of ₹${amount} credited to your account.`, 'medium']
      );
    }

    await conn.commit();
    res.json({
      message:     'Deposit successful',
      reference_no: refNo,
      new_balance:  newBalance,
      risk_score:   fraud.riskScore,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Deposit failed' });
  } finally {
    conn.release();
  }
});

// ── POST /api/transactions/withdraw ──────────────────────────
router.post('/withdraw', auth, async (req, res) => {
  const { account_id, amount, description } = req.body;
  if (!account_id || !amount || amount <= 0)
    return res.status(400).json({ error: 'Invalid withdrawal data' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [acc] = await conn.query(
      'SELECT * FROM accounts WHERE id=? AND user_id=? AND is_frozen=0',
      [account_id, req.user.id]
    );
    if (!acc.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Account not found or frozen' });
    }
    if (parseFloat(acc[0].balance) < parseFloat(amount)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const newBalance = parseFloat(acc[0].balance) - parseFloat(amount);
    await conn.query('UPDATE accounts SET balance=? WHERE id=?', [newBalance, account_id]);

    const fraud = await detectFraud(req.user.id, amount, 'Local', req.ip);
    const refNo = `NX${Date.now()}`;

    const [txnResult] = await conn.query(
      `INSERT INTO transactions
       (user_id,account_id,type,amount,balance_after,reference_no,description,status,ip_address,risk_score,is_suspicious)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, account_id, 'withdraw', amount, newBalance, refNo,
       description || 'Withdrawal', 'completed', req.ip, fraud.riskScore, fraud.isSuspicious ? 1 : 0]
    );

    if (fraud.isSuspicious) {
      await conn.query(
        'INSERT INTO fraud_logs (user_id,transaction_id,risk_score,reason,ml_prediction,rule_triggered) VALUES (?,?,?,?,?,?)',
        [req.user.id, txnResult.insertId, fraud.riskScore,
         `Suspicious withdrawal: ${fraud.reasons}`, fraud.mlPrediction ? 1 : 0, fraud.reasons]
      );
    }

    // Low balance alert
    if (newBalance < 5000) {
      await conn.query(
        'INSERT INTO alerts (user_id,type,message,severity) VALUES (?,?,?,?)',
        [req.user.id, 'low_balance', `Low balance alert: ₹${newBalance.toFixed(2)} remaining.`, 'medium']
      );
    }

    await conn.commit();
    res.json({
      message:      'Withdrawal successful',
      reference_no: refNo,
      new_balance:  newBalance,
      risk_score:   fraud.riskScore,
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Withdrawal failed' });
  } finally {
    conn.release();
  }
});

// ── POST /api/transactions/transfer ──────────────────────────
router.post('/transfer', auth, async (req, res) => {
  const { from_account_id, to_account_no, amount, description } = req.body;
  if (!from_account_id || !to_account_no || !amount || amount <= 0)
    return res.status(400).json({ error: 'Invalid transfer data' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [fromAcc] = await conn.query(
      'SELECT * FROM accounts WHERE id=? AND user_id=? AND is_frozen=0',
      [from_account_id, req.user.id]
    );
    if (!fromAcc.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Source account not found or frozen' });
    }
    if (parseFloat(fromAcc[0].balance) < parseFloat(amount)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const [toAcc] = await conn.query(
      'SELECT * FROM accounts WHERE account_no=? AND is_frozen=0',
      [to_account_no]
    );
    if (!toAcc.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Destination account not found' });
    }

    const fromNew = parseFloat(fromAcc[0].balance) - parseFloat(amount);
    const toNew   = parseFloat(toAcc[0].balance)   + parseFloat(amount);

    await conn.query('UPDATE accounts SET balance=? WHERE id=?', [fromNew, from_account_id]);
    await conn.query('UPDATE accounts SET balance=? WHERE id=?', [toNew,   toAcc[0].id]);

    const fraud  = await detectFraud(req.user.id, amount, null, req.ip);
    const refNo  = `NX${Date.now()}`;
    const status = fraud.isSuspicious ? 'flagged' : 'completed';

    const [txnResult] = await conn.query(
      `INSERT INTO transactions
       (user_id,account_id,type,amount,balance_after,reference_no,description,to_account,from_account,status,ip_address,risk_score,is_suspicious)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, from_account_id, 'transfer', amount, fromNew, refNo,
       description || 'Transfer', to_account_no, fromAcc[0].account_no, status,
       req.ip, fraud.riskScore, fraud.isSuspicious ? 1 : 0]
    );

    if (fraud.isSuspicious) {
      await conn.query(
        'INSERT INTO fraud_logs (user_id,transaction_id,risk_score,reason,ml_prediction,rule_triggered) VALUES (?,?,?,?,?,?)',
        [req.user.id, txnResult.insertId, fraud.riskScore,
         `Suspicious transfer of ₹${amount} to ${to_account_no}. Rules: ${fraud.reasons}`,
         fraud.mlPrediction ? 1 : 0, fraud.reasons]
      );
      await conn.query(
        'INSERT INTO alerts (user_id,type,message,severity) VALUES (?,?,?,?)',
        [req.user.id, 'fraud',
         `🚨 Suspicious transfer of ₹${amount} flagged. Risk score: ${fraud.riskScore}/100`, 'critical']
      );
    }

    await conn.commit();
    res.json({
      message:      fraud.isSuspicious ? 'Transfer flagged for review' : 'Transfer successful',
      reference_no: refNo,
      new_balance:  fromNew,
      risk_score:   fraud.riskScore,
      flagged:      fraud.isSuspicious,
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Transfer failed' });
  } finally {
    conn.release();
  }
});

// ── GET /api/transactions/history ────────────────────────────
router.get('/history', auth, async (req, res) => {
  const { limit = 50, offset = 0, type, status } = req.query;
  try {
    let where = 'WHERE t.user_id = ?';
    const params = [req.user.id];
    if (type)   { where += ' AND t.type = ?';   params.push(type); }
    if (status) { where += ' AND t.status = ?'; params.push(status); }

    const [rows] = await db.query(
      `SELECT t.*, a.account_no FROM transactions t
       LEFT JOIN accounts a ON t.account_id = a.id
       ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ── POST /api/transactions/beneficiary ───────────────────────
router.post('/beneficiary', auth, async (req, res) => {
  const { name, account_number, bank_name, ifsc_code } = req.body;
  if (!name || !account_number)
    return res.status(400).json({ error: 'Name and account number required' });

  try {
    await db.query(
      'INSERT INTO beneficiaries (user_id,name,account_number,bank_name,ifsc_code) VALUES (?,?,?,?,?)',
      [req.user.id, name, account_number, bank_name, ifsc_code]
    );
    res.status(201).json({ message: 'Beneficiary added' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add beneficiary' });
  }
});

// ── GET /api/transactions/beneficiaries ──────────────────────
router.get('/beneficiaries', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM beneficiaries WHERE user_id=? ORDER BY name',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch beneficiaries' });
  }
});

module.exports = router;
