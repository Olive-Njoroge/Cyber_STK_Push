import express from 'express';
import cors from 'cors';
import { config, assertPayheroConfig, callbackUrlWarning, validateCallbackUrl } from './config.js';
import { connectDB } from './db.js';
import { paymentsRouter } from './routes/payments.js';
import { startStaleSweep } from './jobs/staleSweep.js';

const app = express();

// In production this is the Vercel origin. Empty means "any origin", which is
// what local development wants. PayHero's callback sends no Origin header, so
// the allowlist never blocks the webhook.
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, staleSweep: config.enableStaleSweep, missingConfig: assertPayheroConfig() });
});

app.use('/api/payments', paymentsRouter);

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Something broke on the server. Check the server log.' });
});

async function main() {
  // Checked before the DB so a bad value fails in a second, not after a
  // connection timeout.
  const callbackProblem = validateCallbackUrl();
  if (callbackProblem) {
    console.error(`[config] ${callbackProblem}`);
    console.error('[config] PayHero must be able to POST to this URL from the public internet.');
    console.error('[config] Deployed: https://<service>.onrender.com/api/payments/callback');
    console.error('[config] Local:    run `ngrok http 5000` and use the https URL it prints.');
    process.exit(1);
  }

  const callbackWarning = callbackUrlWarning();
  if (callbackWarning) console.warn(`[config] ${callbackWarning}`);

  await connectDB();

  const missing = assertPayheroConfig();
  if (missing.length) {
    console.warn(`[config] missing: ${missing.join(', ')} — STK pushes will be refused until these are set.`);
  }

  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    console.log(`[server] callback URL: ${config.callbackUrl || '(not set)'}`);
    startStaleSweep();
  });
}

main().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});
