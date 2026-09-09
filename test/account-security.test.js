import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountSecurity, KYC_LEVELS } from '../src/account-security.js';

const phone = '+989121234567';
const password = 'VeryStrong!Pass123';

function makeSecurity() {
  return new AccountSecurity({
    humanChallengeVerifier: { verify: ({ token }) => token === 'human-ok' },
    phoneVerifier: { verify: ({ token }) => token === 'otp-ok' }
  });
}

test('registration requires human and phone verification and never exposes password data', () => {
  const security = makeSecurity();
  assert.throws(() => security.register({ phone, password, humanChallengeToken: 'bad', phoneVerificationToken: 'otp-ok' }), /human verification required/);
  const account = security.register({ phone, password, name: 'Test User', humanChallengeToken: 'human-ok', phoneVerificationToken: 'otp-ok' });
  assert.equal(account.kycLevel, KYC_LEVELS.PHONE_VERIFIED);
  assert.equal('credentials' in account, false);
  assert.equal('password' in account, false);
});

test('login creates a session and logout revokes it', () => {
  const security = makeSecurity();
  security.register({ phone, password, humanChallengeToken: 'human-ok', phoneVerificationToken: 'otp-ok' });
  const session = security.login({ phone, password, humanChallengeToken: 'human-ok' });
  assert.ok(session.token);
  assert.equal(security.authenticate(session.token).account.phone, phone);
  security.logout(session.token);
  assert.throws(() => security.authenticate(session.token), /unauthorized/);
});

test('repeated bad passwords lock the account temporarily', () => {
  const security = makeSecurity();
  security.register({ phone, password, humanChallengeToken: 'human-ok', phoneVerificationToken: 'otp-ok' });
  for (let i = 0; i < 5; i++) assert.throws(() => security.login({ phone, password: 'WrongPassword!123', humanChallengeToken: 'human-ok' }), /invalid credentials/);
  assert.throws(() => security.login({ phone, password, humanChallengeToken: 'human-ok' }), /invalid credentials/);
});

test('live actions require full identity verification', () => {
  const security = makeSecurity();
  security.register({ phone, password, humanChallengeToken: 'human-ok', phoneVerificationToken: 'otp-ok' });
  const session = security.login({ phone, password, humanChallengeToken: 'human-ok' });
  assert.throws(() => security.requireKyc(session.token), /identity verification required/);
  security.setKycLevel(session.token, KYC_LEVELS.VERIFIED);
  assert.equal(security.requireKyc(session.token).kycLevel, KYC_LEVELS.VERIFIED);
});
