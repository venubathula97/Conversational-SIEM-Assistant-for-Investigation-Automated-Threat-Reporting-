const express = require('express');
const axios   = require('axios');
const db      = require('../config/db');
const auth    = require('../middleware/authMiddleware');
const router  = express.Router();

// ── AI Chat (calls Anthropic API) ────────────────────────────
router.post('/chat', auth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    // Fetch user context
    const [[user]]   = await db.query(
      'SELECT name,email,role FROM users WHERE id=?', [req.user.id]);
    const [accounts] = await db.query(
      'SELECT type,balance,account_no FROM accounts WHERE user_id=?', [req.user.id]);
    const [alerts]   = await db.query(
      'SELECT type,message,severity FROM alerts WHERE user_id=? AND is_read=0 LIMIT 5',
      [req.user.id]);
    const [txns]     = await db.query(
      'SELECT type,amount,description,status,created_at FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 10',
      [req.user.id]);

    const systemPrompt = `You are NexaBot, the AI banking assistant for NexaBank — a professional, secure digital bank.
You help customers with their banking queries in a friendly, concise, and professional manner.

Customer context:
- Name: ${user.name}
- Role: ${user.role}
- Accounts: ${JSON.stringify(accounts)}
- Recent unread alerts: ${JSON.stringify(alerts)}
- Recent transactions: ${JSON.stringify(txns)}

You can answer questions about:
- Account balances and transaction history
- Fraud alerts and suspicious activity
- Loans, EMIs, fixed deposits, credit cards
- Banking tips and financial advice
- How to use NexaBank features

Always be concise (2-4 sentences max unless detail is needed).
If asked about fraud or suspicious activity, summarize from the alerts.
Never reveal raw SQL. Format currency in Indian Rupees (₹).`;

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 500,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: message }],
      },
      {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 15000,
      }
    );

    const reply = response.data.content[0].text;
    res.json({ reply });
  } catch (err) {
    console.error('AI error:', err.message);
    // Fallback response if API key not set
    const fallback = generateFallback(message, req.user);
    res.json({ reply: fallback, fallback: true });
  }
});

// ── Fallback response when API unavailable ────────────────────
function generateFallback(message, user) {
  const msg = message.toLowerCase();
  if (msg.includes('balance'))    return `Hello! Please check your dashboard for real-time account balances.`;
  if (msg.includes('fraud'))      return `I've detected some suspicious activity on your account. Please review your fraud alerts in the Alerts section.`;
  if (msg.includes('transfer'))   return `To transfer money, go to Money Operations → Transfer. Enter the recipient's account number and amount.`;
  if (msg.includes('loan'))       return `View your loan details and pay EMIs from the Loans section on your dashboard.`;
  if (msg.includes('deposit'))    return `To make a deposit, go to Money Operations → Deposit and select your account.`;
  if (msg.includes('credit'))     return `Your credit card details including limit and usage are available in the Dashboard.`;
  if (msg.includes('fd') || msg.includes('fixed')) return `Fixed deposit information is shown on your dashboard. You can create new FDs from the Deposits section.`;
  return `Hi! I'm NexaBot, your banking assistant. I can help you with balances, transfers, loans, fraud alerts, and more. What would you like to know?`;
}

module.exports = router;
