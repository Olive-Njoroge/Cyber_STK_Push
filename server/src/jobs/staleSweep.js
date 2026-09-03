/**
 * Optional background sweep, behind ENABLE_STALE_SWEEP.
 *
 * Callbacks get lost. Once a minute this asks PayHero about rows that have been
 * unresolved for a while, so a transaction resolves itself even if the
 * attendant never presses "Check status".
 */
import cron from 'node-cron';
import { config } from '../config.js';
import { Transaction } from '../models/Transaction.js';
import { sweepStaleStatuses, verifyTransaction } from '../services/transactions.js';

const BATCH_SIZE = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Give up on rows older than a day.

export function startStaleSweep() {
  if (!config.enableStaleSweep) {
    console.log('[sweep] disabled (ENABLE_STALE_SWEEP is not true)');
    return null;
  }

  const task = cron.schedule('* * * * *', runSweep, { scheduled: true });
  console.log('[sweep] enabled, running every minute');
  return task;
}

async function runSweep() {
  try {
    await sweepStaleStatuses();

    const now = Date.now();
    const rows = await Transaction.find({
      status: { $in: ['PENDING', 'STALE'] },
      createdAt: { $gte: new Date(now - MAX_AGE_MS), $lt: new Date(now - config.staleAfterMs) },
    })
      .sort({ lastVerifiedAt: 1, createdAt: 1 })
      .limit(BATCH_SIZE);

    if (rows.length === 0) return;

    for (const tx of rows) {
      try {
        const fresh = await verifyTransaction(tx, { force: true });
        if (fresh.status !== tx.status) {
          console.log(`[sweep] ${tx.externalReference}: ${tx.status} -> ${fresh.status}`);
        }
      } catch (err) {
        console.warn(`[sweep] ${tx.externalReference}: ${err?.message}`);
      }
    }
  } catch (err) {
    console.error('[sweep] failed:', err?.message);
  }
}
