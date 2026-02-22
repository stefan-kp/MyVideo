const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const SECRET = process.env.JWT_SECRET;

function generateStreamToken(channelId) {
  if (!SECRET) throw new Error('JWT_SECRET not configured');
  return jwt.sign(
    { sub: channelId, jti: uuidv4() },
    SECRET,
    { expiresIn: '4h' }
  );
}

function validateStreamToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET not configured');
  return jwt.verify(token, SECRET);
}

function authMiddleware() {
  return (req, res, next) => {
    const token = req.query.token;
    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }
    try {
      req.tokenPayload = validateStreamToken(token);
      next();
    } catch (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { generateStreamToken, validateStreamToken, authMiddleware };
