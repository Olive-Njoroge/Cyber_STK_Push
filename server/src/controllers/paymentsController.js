import mongoose from 'mongoose';
import { config, assertPayheroConfig } from '../config.js';
import { Transaction } from '../models/Transaction.js';
import { normalizePhone } from '../utils/phone.js';
import { generateExternalReference } from '../utils/reference.js';
import { initiateStkPush, parseCallback } from '../services/payhero.js';
import {
  applyPaymentResult,
  checkResendGuards,
  markStaleIfNeeded,
  sweepStaleStatuses,
  verifyTransaction,
} from '../services/transactions.js';

const MAX_AMOUNT = 150000; // M-Pesa per-transaction ceiling.

/** POST /api/payments */
export async function createPayment(req, res, next) {
  try {
    const missing = assertPayheroConfig();
    if (missing.length) {
      return res.status(500).json({
        error: `Server is not configured. Missing: ${missing.join(', ')}. Fill these in server/.env and restart.`,
      });
    }

    const phoneNumber = normalizePhone(req.body?.phoneNumber);
    if (!phoneNumber) {
      return res.status(400).json({
        error: 'Enter a valid Safaricom number, e.g. 0712345678.',
        field: 'phoneNumber',
      });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
      return res.status(400).json({
        error: `Amount must be a whole number between 1 and ${MAX_AMOUNT.toLocaleString()}.`,
        field: 'amount',
      });
    }

    const customerName = String(req.body?.customerName ?? '').trim().slice(0, 60);

    const guard = await checkResendGuards(phoneNumber);
    if (guard.blocked) {
      return res.status(429).json({ error: guard.reason, retryInMs: guard.retryInMs ?? 0 });
    }

    // Saved as PENDING before PayHero is called, so a crash mid-request still
    // leaves a row the attendant can verify later.
    const tx = await Transaction.create({
      phoneNumber,
      amount,
      customerName,
      externalReference: generateExternalReference(),
      status: 'PENDING',
      resultDescription: 'Sending prompt...',
    });

    try {
      const push = await initiateStkPush({
        amount,
        phoneNumber,
        customerName,
        externalReference: tx.externalReference,
      });

      tx.checkoutRequestId = push.checkoutRequestId;
      tx.payheroReference = push.payheroReference;
      tx.resultDescription = 'Prompt sent. Waiting for the customer to enter their PIN.';
      await tx.save();

      return res.status(201).json({ transaction: tx.toClientJSON() });
    } catch (err) {
      // The push never left the building. Say so plainly and record it.
      tx.status = 'FAILED';
      tx.resultDescription = err?.message || 'Could not reach PayHero.';
      await tx.save();

      console.error('[payments] STK push failed:', tx.externalReference, err?.message);
      return res.status(502).json({
        error: `No prompt was sent. ${tx.resultDescription}`,
        transaction: tx.toClientJSON(),
      });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payments/callback
 * PayHero's webhook. No auth middleware, and it always answers 200 so PayHero
 * does not retry against a body we simply do not recognise.
 */
export async function handleCallback(req, res) {
  try {
    console.log('[callback] received:', JSON.stringify(req.body));

    const result = parseCallback(req.body);
    if (!result) {
      console.warn('[callback] unrecognised payload, ignoring');
      return res.status(200).json({ received: true, matched: false });
    }

    const query = result.externalReference
      ? { externalReference: result.externalReference }
      : { checkoutRequestId: result.checkoutRequestId };

    const tx = await Transaction.findOne(query);
    if (!tx) {
      console.warn('[callback] no transaction for', JSON.stringify(query));
      return res.status(200).json({ received: true, matched: false });
    }

    const updated = await applyPaymentResult(tx, result);
    console.log(`[callback] ${tx.externalReference} -> ${updated.status}`);

    return res.status(200).json({ received: true, matched: true });
  } catch (err) {
    // Still 200: a retry storm would not help us here.
    console.error('[callback] handler error:', err);
    return res.status(200).json({ received: true, matched: false });
  }
}

/** GET /api/payments/:id */
export async function getPayment(req, res, next) {
  try {
    const tx = await findById(req.params.id, res);
    if (!tx) return undefined;

    const fresh = await markStaleIfNeeded(tx);
    return res.json({ transaction: fresh.toClientJSON() });
  } catch (err) {
    next(err);
  }
}

/** GET /api/payments/:id/verify */
export async function verifyPayment(req, res, next) {
  try {
    const tx = await findById(req.params.id, res);
    if (!tx) return undefined;

    try {
      const fresh = await verifyTransaction(tx);
      return res.json({ transaction: fresh.toClientJSON() });
    } catch (err) {
      // Could not reach PayHero. Hand back the row we have plus an honest error.
      const current = await markStaleIfNeeded(await Transaction.findById(tx._id));
      return res.status(502).json({
        error: err?.message || 'Could not reach PayHero to check this payment.',
        transaction: current.toClientJSON(),
      });
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/payments?page=1&limit=50&today=true */
export async function listPayments(req, res, next) {
  try {
    await sweepStaleStatuses();

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const filter = {};
    if (['1', 'true', 'yes'].includes(String(req.query.today).toLowerCase())) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      filter.createdAt = { $gte: start };
    }

    const [rows, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Transaction.countDocuments(filter),
    ]);

    return res.json({
      transactions: rows.map((r) => r.toClientJSON()),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (err) {
    next(err);
  }
}

async function findById(id, res) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ error: 'Not a valid transaction id.' });
    return null;
  }
  const tx = await Transaction.findById(id);
  if (!tx) {
    res.status(404).json({ error: 'Transaction not found.' });
    return null;
  }
  return tx;
}

export const _internals = { MAX_AMOUNT, staleAfterMs: config.staleAfterMs };
