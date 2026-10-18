// Manager login: one manager account, set with environment variables.
//
//   MANAGER_EMAIL     the manager's email (optional, but recommended)
//   MANAGER_PASSWORD  the manager's password. Leave it empty to turn login OFF (handy for local dev).
//
// How it works, in short:
//  - POST /api/auth/login checks email + password and returns a signed token (valid 7 days).
//  - The manager dashboard sends it back as "Authorization: Bearer <token>".
//  - Every /api route needs that token EXCEPT the few the customer app uses (PUBLIC below).
//  - Tokens are signed with a key derived from the email + password, so changing the password on the
//    host (e.g. Heroku config vars) logs everyone out. No database table, no extra packages.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';

const TOKEN_DAYS = 7;
const MAX_FAILS = 5; // wrong passwords in a row (per IP) before a 1-minute pause
const LOCK_MS = 60_000;

const managerEmail = () => (process.env.MANAGER_EMAIL ?? '').trim().toLowerCase();
const managerPassword = () => process.env.MANAGER_PASSWORD ?? '';
export const authEnabled = () => managerPassword().length > 0;

// Routes the customer app (and health checks) call without logging in. Everything else is manager-only.
const PUBLIC: [method: string, path: string | RegExp][] = [
  ['GET', '/health'],
  ['GET', '/menu'],
  ['GET', '/inventory'],
  ['GET', '/status'],
  ['POST', '/orders'],
  ['POST', '/orders/precheck'],
  ['GET', /^\/orders\/[^/]+$/], // one order's status, for the customer's tracking page
  ['GET', '/auth/config'],
  ['POST', '/auth/login'],
];

// ---- tokens ----------------------------------------------------------------------

function signingKey() {
  return createHash('sha256').update(`barmade-manager:${managerEmail()}:${managerPassword()}`).digest();
}

function sign(payload: string) {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

function issueToken(email: string) {
  const payload = Buffer.from(JSON.stringify({ sub: email, exp: Date.now() + TOKEN_DAYS * 86_400_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string): { sub: string; exp: number } | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof data.exp === 'number' && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/** Constant-time string comparison (hash first so different lengths don't leak). */
function same(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function bearer(req: Request) {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// ---- middleware --------------------------------------------------------------------

function isPublic(req: Request) {
  return PUBLIC.some(([method, path]) => req.method === method && (typeof path === 'string' ? req.path === path : path.test(req.path)));
}

/** Mount on /api: lets public routes through and requires a valid manager token for the rest. */
export function requireManager(req: Request, res: Response, next: NextFunction) {
  if (!authEnabled() || req.method === 'OPTIONS' || isPublic(req)) return next();
  if (verifyToken(bearer(req))) return next();
  res.status(401).json({ error: 'Please log in' });
}

// ---- routes --------------------------------------------------------------------------

const fails = new Map<string, { count: number; lockedUntil: number }>();

export const authRoutes = Router();

/** The dashboard asks this first: is a login needed at all? */
authRoutes.get('/auth/config', (_req, res) => {
  res.json({ required: authEnabled() });
});

authRoutes.post('/auth/login', (req, res) => {
  if (!authEnabled()) return res.json({ token: null, required: false });

  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const record = fails.get(ip);
  if (record && record.lockedUntil > now) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const emailOk = !managerEmail() || same(email, managerEmail());
  const passwordOk = same(password, managerPassword());

  if (!(emailOk && passwordOk)) {
    const count = (record && record.lockedUntil <= now && record.count >= MAX_FAILS ? 0 : record?.count ?? 0) + 1;
    fails.set(ip, { count, lockedUntil: count >= MAX_FAILS ? now + LOCK_MS : 0 });
    return res.status(401).json({ error: 'Wrong email or password' });
  }

  fails.delete(ip);
  res.json({ token: issueToken(managerEmail() || 'manager'), email: managerEmail() || null });
});

/** Lets the dashboard check that a saved token is still valid. */
authRoutes.get('/auth/me', (req, res) => {
  if (!authEnabled()) return res.json({ ok: true, required: false });
  const data = verifyToken(bearer(req));
  if (!data) return res.status(401).json({ error: 'Please log in' });
  res.json({ ok: true, email: data.sub });
});
