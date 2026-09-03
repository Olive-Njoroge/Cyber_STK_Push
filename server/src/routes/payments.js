import { Router } from 'express';
import {
  createPayment,
  getPayment,
  handleCallback,
  listPayments,
  verifyPayment,
} from '../controllers/paymentsController.js';

export const paymentsRouter = Router();

// PayHero's webhook. Registered first, and deliberately free of any auth
// middleware — PayHero has no way to authenticate to us.
paymentsRouter.post('/callback', handleCallback);

paymentsRouter.post('/', createPayment);
paymentsRouter.get('/', listPayments);
paymentsRouter.get('/:id/verify', verifyPayment);
paymentsRouter.get('/:id', getPayment);
