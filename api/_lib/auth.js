import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// The signing secret decides who is an admin. Anyone who knows it can mint a
// token claiming any identity and any role, WITHOUT a password - so a publicly
// known fallback is not a weak secret, it is no authentication at all.
//
// The old fallback string was published in this repository, which is public.
// It is gone. In a real deployment a missing JWT_SECRET now fails closed and
// says exactly what to do; locally, where there is no database and nothing to
// protect, the dev fallback keeps `vercel dev` friction-free.
const IS_DEPLOYED = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.VERCEL);
const SECRET = process.env.JWT_SECRET || (IS_DEPLOYED ? '' : 'local-dev-only-not-for-deployment');

export const SECRET_MISSING = !SECRET;
export const SECRET_MISSING_MESSAGE =
  'Server is not configured: JWT_SECRET is not set. Add it in Vercel ▸ Settings ▸ ' +
  'Environment Variables (any long random string) and redeploy. Sign-in is disabled until then.';

if (SECRET_MISSING) console.error('[auth] ' + SECRET_MISSING_MESSAGE);

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signToken(user) {
  if (SECRET_MISSING) throw new Error(SECRET_MISSING_MESSAGE);
  return jwt.sign(
    { uid: user.id, role: user.role, email: user.email, name: user.name },
    SECRET,
    { expiresIn: '30d' } // long-lived so reps stay logged in
  );
}

export function verifyToken(token) {
  // Fail closed. Accepting a token we cannot actually verify would mean
  // trusting whatever role the caller typed into it.
  if (SECRET_MISSING) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

// Returns the decoded token payload ({ uid, role, email, name }) or null.
export function getAuthUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return verifyToken(match[1]);
}
