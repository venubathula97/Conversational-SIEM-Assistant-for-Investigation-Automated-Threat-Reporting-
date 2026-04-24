// credits.js
const express = require('express');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const router  = express.Router();

router.get('/', auth, async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM credit_cards WHERE user_id=?', [req.user.id]);
  res.json(rows);
});

router.post('/spend', auth, async (req, res) => {
  const { card_id, amount, description } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [card] = await conn.query(
      'SELECT * FROM credit_cards WHERE id=? AND user_id=? AND status="active"',
      [card_id, req.user.id]);
    if (!card.length) { await conn.rollback(); return res.status(404).json({ error: 'Card not found' }); }

    const available = parseFloat(card[0].limit_amount) - parseFloat(card[0].used_amount);
    if (amount > available) { await conn.rollback(); return res.status(400).json({ error: 'Credit limit exceeded' }); }

    const newUsed = parseFloat(card[0].used_amount) + parseFloat(amount);
    await conn.query('UPDATE credit_cards SET used_amount=? WHERE id=?', [newUsed, card_id]);
    await conn.commit();
    res.json({ message: 'Credit transaction done', used_amount: newUsed });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Transaction failed' });
  } finally { conn.release(); }
});

module.exports = router;
