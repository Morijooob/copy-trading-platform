import crypto from 'node:crypto';

const PASSWORD_MIN_LENGTH = 12;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24;

function normalizePhone(phone) {
  const value = String(phone || '').replace(/[\s-]/g, '');
  if (!/^\+98\d{10}$/.test(value)) throw new Error('invalid Iranian mobile number');
  return value;
}

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('invalid email');
  return value || null;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) throw new Error(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  const hash = crypto.scryptSync(value, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, stored) {
  const derived = crypto.scryptSync(String(password || ''), stored.salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(stored.hash, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export const KYC_LEVELS = Object.freeze({ UNVERIFIED: 'UNVERIFIED', PHONE_VERIFIED: 'PHONE_VERIFIED', IDENTITY_PENDING: 'IDENTITY_PENDING', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' });

export class AccountSecurity {
  constructor({ humanChallengeVerifier = null, phoneVerifier = null, clock = () => Date.now() } = {}) {
    this.accounts = new Map();
    this.sessions = new Map();
    this.loginFailures = new Map();
    this.humanChallengeVerifier = humanChallengeVerifier;
    this.phoneVerifier = phoneVerifier;
    this.clock = clock;
  }

  register({ phone, password, name, email = null, humanChallengeToken = null, phoneVerificationToken = null }) {
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = normalizeEmail(email);
    if (this.accounts.has(normalizedPhone)) throw new Error('account already exists');
    this.assertHuman(humanChallengeToken);
    if (this.phoneVerifier && !this.phoneVerifier.verify({ phone: normalizedPhone, token: phoneVerificationToken })) {
      throw new Error('phone verification failed');
    }
    const credentials = hashPassword(password);
    const account = {
      userId: id('usr'), phone: normalizedPhone, name: String(name || '').trim().slice(0, 80) || 'کاربر', email: normalizedEmail,
      credentials, role: 'FOLLOWER', kycLevel: this.phoneVerifier ? KYC_LEVELS.PHONE_VERIFIED : KYC_LEVELS.UNVERIFIED,
      createdAt: new Date(this.clock()).toISOString(), lockedUntil: 0
    };
    this.accounts.set(normalizedPhone, account);
    return this.publicAccount(account);
  }

  login({ phone, password, humanChallengeToken = null }) {
    const normalizedPhone = normalizePhone(phone);
    this.assertHuman(humanChallengeToken);
    const account = this.accounts.get(normalizedPhone);
    const now = this.clock();
    if (!account || account.lockedUntil > now) throw new Error('invalid credentials');
    if (!verifyPassword(password, account.credentials)) {
      const failures = (this.loginFailures.get(normalizedPhone) || 0) + 1;
      this.loginFailures.set(normalizedPhone, failures);
      if (failures >= 5) account.lockedUntil = now + 15 * 60 * 1000;
      throw new Error('invalid credentials');
    }
    this.loginFailures.delete(normalizedPhone);
    account.lockedUntil = 0;
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(token, { accountId: account.userId, expiresAt: now + SESSION_TTL_MS });
    return { token, expiresAt: new Date(now + SESSION_TTL_MS).toISOString(), account: this.publicAccount(account) };
  }

  authenticate(token) {
    const session = this.sessions.get(String(token || ''));
    if (!session || session.expiresAt <= this.clock()) throw new Error('unauthorized');
    const account = [...this.accounts.values()].find(item => item.userId === session.accountId);
    if (!account) throw new Error('unauthorized');
    return { ...session, account: this.publicAccount(account) };
  }

  logout(token) {
    this.sessions.delete(String(token || ''));
    return { ok: true };
  }

  updateProfile(token, { name, email }) {
    const session = this.authenticate(token);
    const account = [...this.accounts.values()].find(item => item.userId === session.accountId);
    if (name !== undefined) account.name = String(name).trim().slice(0, 80) || account.name;
    if (email !== undefined) account.email = normalizeEmail(email);
    return this.publicAccount(account);
  }

  setKycLevel(token, level) {
    if (!Object.values(KYC_LEVELS).includes(level)) throw new Error('invalid kyc level');
    const session = this.authenticate(token);
    const account = [...this.accounts.values()].find(item => item.userId === session.accountId);
    account.kycLevel = level;
    return this.publicAccount(account);
  }

  requireKyc(token) {
    const account = this.authenticate(token).account;
    if (account.kycLevel !== KYC_LEVELS.VERIFIED) throw new Error('identity verification required');
    return account;
  }

  assertHuman(token) {
    if (!this.humanChallengeVerifier) return;
    if (!token || !this.humanChallengeVerifier.verify(token)) throw new Error('human verification required');
  }

  publicAccount(account) {
    return { userId: account.userId, phone: account.phone, name: account.name, email: account.email, role: account.role, kycLevel: account.kycLevel, createdAt: account.createdAt };
  }
}
