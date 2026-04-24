const express = require('express');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const router  = express.Router();

router.get('/', auth, async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
    [req.user.id]);
  res.json(rows);
});

router.get('/unread-count', auth, async (req, res) => {
  const [rows] = await db.query(
    'SELECT COUNT(*) as count FROM alerts WHERE user_id=? AND is_read=0',
    [req.user.id]);
  res.json({ count: rows[0].count });
});

router.put('/:id/read', auth, async (req, res) => {
  await db.query(
    'UPDATE alerts SET is_read=1 WHERE id=? AND user_id=?',
    [req.params.id, req.user.id]);
  res.json({ message: 'Alert marked as read' });
});

router.put('/read-all', auth, async (req, res) => {
  await db.query('UPDATE alerts SET is_read=1 WHERE user_id=?', [req.user.id]);
  res.json({ message: 'All alerts marked as read' });
});

module.exports = router;
