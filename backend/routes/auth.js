const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { protect } = require('../middleware/auth');

const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'All fields required' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
      return res.status(400).json({ success: false, message: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name, email, password) VALUES (?,?,?)').run(name, email.toLowerCase(), hashed);
    const token = signToken(result.lastInsertRowid);
    res.status(201).json({ success: true, token, user: { _id: result.lastInsertRowid, name, email: email.toLowerCase() } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = signToken(user.id);
    res.json({ success: true, token, user: { _id: user.id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/me', protect, (req, res) => res.json({ success: true, user: req.user }));

module.exports = router;
