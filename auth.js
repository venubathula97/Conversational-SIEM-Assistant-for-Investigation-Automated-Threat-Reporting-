const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('../config/db');
const auth     = require('../middleware/authMiddleware');
const router   = express.Router();

// ── Helper: generate account number ──────────────────────────
const genAccountNo = (userId) =>
  `NX${String(Date.now()).slice(-8)}${String(userId).padStart(4,'0')}`;

// ── Helper: log audit ─────────────────────────────────────────
const auditLog = async (userId, action, details, ip) => {
  await db.query(
    'INSERT INTO audit_logs (user_id, action, details, ip) VALUES (?,?,?,?)',
    [userId, action, JSON.stringify(details), ip]
  );
};

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password required' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query('SELECT id FROM users WHERE email=?', [email]);
    if (existing.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [userResult] = await conn.query(
      'INSERT INTO users (name,email,password,phone) VALUES (?,?,?,?)',
      [name, email, hash, phone || null]
    );
    const userId = userResult.insertId;

    // Create default savings account
    const accountNo = genAccountNo(userId);
    const [accResult] = await conn.query(
      'INSERT INTO accounts (user_id,account_no,type,balance) VALUES (?,?,?,?)',
      [userId, accountNo, 'savings', 0]
    );
    await conn.query(
      'INSERT INTO savings_accounts (user_id,account_id,balance,interest_rate) VALUES (?,?,?,?)',
      [userId, accResult.insertId, 0, 4.50]
    );

    await conn.commit();

    const token = jwt.sign(
      { id: userId, role: 'customer' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: userId, name, email, role: 'customer' }
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    conn.release();
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const ip     = req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';
  const device = req.headers['user-agent'] || 'Unknown';

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await db.query(
        'INSERT INTO login_activity (user_id,ip,device,status) VALUES (?,?,?,?)',
        [user.id, ip, device, 'failed']
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.is_blocked)
      return res.status(403).json({ error: 'Account is blocked. Contact support.' });

    await db.query(
      'INSERT INTO login_activity (user_id,ip,device,status) VALUES (?,?,?,?)',
      [user.id, ip, device, 'success']
    );

    await auditLog(user.id, 'USER_LOGIN', { email, ip }, ip);

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id,name,email,phone,address,role,otp_enabled,created_at FROM users WHERE id=?',
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── PUT /api/auth/profile ─────────────────────────────────────
router.put('/profile', auth, async (req, res) => {
  const { name, phone, address } = req.body;
  try {
    await db.query(
      'UPDATE users SET name=?,phone=?,address=? WHERE id=?',
      [name, phone, address, req.user.id]
    );
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ── PUT /api/auth/change-password ────────────────────────────
router.put('/change-password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  try {
    const [rows] = await db.query('SELECT password FROM users WHERE id=?', [req.user.id]);
    const match = await bcrypt.compare(current_password, rows[0].password);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password=? WHERE id=?', [hash, req.user.id]);
    await auditLog(req.user.id, 'PASSWORD_CHANGED', {}, req.ip);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;
