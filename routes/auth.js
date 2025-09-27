import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

const router = Router();

function signToken(user) {
  const payload = { sub: user._id.toString(), email: user.email, name: user.name };
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: 'email_in_use' });
    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await User.create({ name, email, passwordHash });
    const token = signToken(user);
    return res.json({ token, user: user.toSafeJSON() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'register_failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken(user);
    return res.json({ token, user: user.toSafeJSON() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'login_failed' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing_token' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token' });
  }
});

export default router;
