import crypto from 'crypto';

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'todonotes_auth';
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_HOURS || 24) * 60 * 60 * 1000;

function isAuthEnabled() {
  return Boolean(
    process.env.AUTH_CODE_HASH &&
    process.env.AUTH_CODE_SALT &&
    process.env.AUTH_SESSION_SECRET
  );
}

function hashCode(code) {
  return crypto.scryptSync(code, process.env.AUTH_CODE_SALT, 64).toString('hex');
}

function safeEqualHex(left, right) {
  const leftBuf = Buffer.from(left, 'hex');
  const rightBuf = Buffer.from(right, 'hex');

  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function sign(value) {
  return crypto
    .createHmac('sha256', process.env.AUTH_SESSION_SECRET)
    .update(value)
    .digest('base64url');
}

function createSessionValue() {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + SESSION_TTL_MS,
    })
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};

  return header.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function readSession(req) {
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;
  if (sign(payload) !== signature) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.exp || Date.now() > session.exp) return null;
    return session;
  } catch {
    return null;
  }
}

function isAuthenticated(req) {
  if (!isAuthEnabled()) return true;
  return Boolean(readSession(req));
}

function setSessionCookie(res) {
  const sessionValue = createSessionValue();
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === 'production';

  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${sessionValue}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';

  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; '));
}

function verifyCode(code) {
  if (!isAuthEnabled()) return true;
  if (typeof code !== 'string' || code.length === 0) return false;

  const actualHash = hashCode(code);
  return safeEqualHex(actualHash, process.env.AUTH_CODE_HASH);
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();

  return res.status(401).json({
    success: false,
    code: 'AUTH_REQUIRED',
    error: 'Authentication required.',
  });
}

export {
  clearSessionCookie,
  isAuthEnabled,
  isAuthenticated,
  requireAuth,
  setSessionCookie,
  verifyCode,
};
