/**
 * Transaction state transitions.
 *
 * Both the PayHero callback and the manual verify path funnel through
 * applyPaymentResult(). It is the single writer of an outcome onto a
 * transaction, and it is idempotent: a SUCCESS is final and a late callback
 * cannot walk it back.
 */
import { config } from '../config.js';
import { Transaction } from '../models/Transaction.js';
import { fetchTransactionStatus } from './payhero.js';

/**
 * Write a PaymentResult (see services/payhero.js) onto a transaction.
 *
 * @param {import('mongoose').Document} tx
 * @param {object} result canonical PaymentResult
 * @returns {Promise<object>} the transaction as it now stands
 */
export async function applyPaymentResult(tx, result) {
  if (!tx || !result) return tx;

  // Terminal. A duplicate or late callback must not overwrite a paid transaction.
  if (tx.status === 'SUCCESS') {
    if (!tx.lastVerifiedAt || Date.now() - tx.lastVerifiedAt.getTime() > 1000) {
      await Transaction.updateOne({ _id: tx._id }, { $set: { lastVerifiedAt: new Date() } });
      tx.lastVerifiedAt = new Date();
    }
    return tx;
  }

  const update = { lastVerifiedAt: new Date() };

  if (result.checkoutRequestId && !tx.checkoutRequestId) {
    update.checkoutRequestId = result.checkoutRequestId;
  }
  if (result.payheroReference && !tx.payheroReference) {
    update.payheroReference = result.payheroReference;
  }

  if (result.status === 'SUCCESS' || result.status === 'FAILED') {
    update.status = result.status;
    update.resultCode = result.resultCode || '';
    update.resultDescription = result.resultDescription || '';
    if (result.status === 'SUCCESS' && result.mpesaReceipt) {
      update.mpesaReceipt = result.mpesaReceipt;
    }
  } else if (isStale(tx)) {
    // Still unresolved and old enough that the attendant should stop waiting.
    update.status = 'STALE';
    if (result.resultDescription) update.resultDescription = result.resultDescription;
  } else if (result.resultDescription && !tx.resultDescription) {
    update.resultDescription = result.resultDescription;
  }

  // Guard against the callback and a verify landing at the same instant: only
  // write if the row is still not SUCCESS.
  const updated = await Transaction.findOneAndUpdate(
    { _id: tx._id, status: { $ne: 'SUCCESS' } },
    { $set: update },
    { new: true }
  );

  return updated ?? (await Transaction.findById(tx._id));
}

export function isStale(tx) {
  if (!tx?.createdAt) return false;
  return Date.now() - new Date(tx.createdAt).getTime() > config.staleAfterMs;
}

/**
 * A PENDING row older than the stale window is unknown, not failed. Flip it so
 * the attendant sees grey instead of an optimistic "waiting" forever.
 */
export async function markStaleIfNeeded(tx) {
  if (!tx || tx.status !== 'PENDING' || !isStale(tx)) return tx;

  const updated = await Transaction.findOneAndUpdate(
    { _id: tx._id, status: 'PENDING' },
    { $set: { status: 'STALE' } },
    { new: true }
  );
  return updated ?? tx;
}

/** Bulk version, used before listing rows. */
export async function sweepStaleStatuses() {
  const cutoff = new Date(Date.now() - config.staleAfterMs);
  const res = await Transaction.updateMany(
    { status: 'PENDING', createdAt: { $lt: cutoff } },
    { $set: { status: 'STALE' } }
  );
  return res.modifiedCount ?? 0;
}

/**
 * Ask PayHero for the truth and write it down.
 *
 * Throws whatever payhero.js throws when PayHero is unreachable, so the caller
 * can say "could not reach PayHero" rather than inventing a status.
 */
export async function verifyTransaction(tx, { force = false } = {}) {
  if (tx.status === 'SUCCESS') return tx;

  // Cheap throttle so a jumpy attendant cannot hammer PayHero.
  if (!force && tx.lastVerifiedAt && Date.now() - tx.lastVerifiedAt.getTime() < config.verifyCooldownMs) {
    return markStaleIfNeeded(tx);
  }

  const result = await fetchTransactionStatus({
    payheroReference: tx.payheroReference,
    externalReference: tx.externalReference,
  });

  if (!result) {
    // PayHero answered but has nothing for us. Age the row rather than lying.
    await Transaction.updateOne({ _id: tx._id }, { $set: { lastVerifiedAt: new Date() } });
    const refreshed = await Transaction.findById(tx._id);
    return markStaleIfNeeded(refreshed);
  }

  return applyPaymentResult(tx, result);
}

/**
 * Resend guards. PayHero blocks a phone number for 24 hours after 10 successive
 * failed or cancelled pushes, and throttles the whole account at 50 failures in
 * a 6 hour window, so we stop well short of both.
 *
 * @returns {Promise<{blocked: boolean, reason?: string, retryInMs?: number}>}
 */
export async function checkResendGuards(phoneNumber) {
  const recent = await Transaction.find({ phoneNumber })
    .sort({ createdAt: -1 })
    .limit(config.maxConsecutiveFailures)
    .lean();

  const last = recent[0];
  if (last) {
    const age = Date.now() - new Date(last.createdAt).getTime();
    if (age < config.resendCooldownMs && last.status !== 'FAILED') {
      return {
        blocked: true,
        reason: `A push was already sent to this number ${Math.round(age / 1000)}s ago. Wait for it to resolve before resending.`,
        retryInMs: config.resendCooldownMs - age,
      };
    }
  }

  const consecutiveFailures = countLeadingFailures(recent);
  if (consecutiveFailures >= config.maxConsecutiveFailures) {
    return {
      blocked: true,
      reason: `${consecutiveFailures} failed pushes in a row to this number. PayHero blocks a number for 24 hours at 10 — check the number with the customer before trying again.`,
    };
  }

  return { blocked: false };
}

function countLeadingFailures(rows) {
  let n = 0;
  for (const row of rows) {
    if (row.status !== 'FAILED') break;
    n += 1;
  }
  return n;
}
