const REQUIRED = [
  'BACKEND_ONLY_EXECUTION',
  'AUTHENTICATED_SESSIONS',
  'SECURE_COOKIES',
  'TWO_FACTOR_REAL_TRADING',
  'SERVER_SIDE_SECRET_STORE',
  'WITHDRAWALS_DISABLED',
  'KILL_SWITCH',
  'RISK_LIMITS',
  'IDEMPOTENCY',
  'AUDIT_INTEGRITY',
  'MONITORING_ALERTS'
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const missing = REQUIRED.filter((key) => process.env[key] !== 'true');
  return res.status(200).json({
    ok: true,
    readyForRealMoney: false,
    realTradingEnabled: false,
    missingControls: missing,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    exchangeConfigured: Boolean(process.env.EXIR_API_KEY && process.env.EXIR_API_SECRET)
  });
}
