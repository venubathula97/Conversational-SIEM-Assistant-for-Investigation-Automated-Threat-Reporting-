const jwt  = require('jsonwebtoken');
const db   = require('../config/db');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Load fresh user from DB to check is_blocked
    const [rows] = await db.query(
      'SELECT id, name, email, role, is_blocked FROM users WHERE id = ?',
      [decoded.id]
    );
    if (!rows.length)       return res.status(401).json({ error: 'User not found' });
    if (rows[0].is_blocked) return res.status(403).json({ error: 'Account is blocked' });

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = authMiddleware;
