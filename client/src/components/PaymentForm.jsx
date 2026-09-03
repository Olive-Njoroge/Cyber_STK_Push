import { useState } from 'react';
import { normalizePhone } from '../phone.js';

const MAX_AMOUNT = 150000;

export default function PaymentForm({ onSend, sending, submitError, cooldownSecondsFor }) {
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState({});

  const normalized = normalizePhone(phone);
  const cooldown = normalized ? cooldownSecondsFor(normalized) : 0;
  const disabled = sending || cooldown > 0;

  function validate() {
    const next = {};
    if (!phone.trim()) next.phone = 'Enter the customer phone number.';
    else if (!normalized) next.phone = 'Not a valid Safaricom number. Use 07xx or 01xx.';

    const value = Number(amount);
    if (!amount.toString().trim()) next.amount = 'Enter the amount owed.';
    else if (!Number.isInteger(value) || value < 1) next.amount = 'Amount must be a whole number, at least 1.';
    else if (value > MAX_AMOUNT) next.amount = `M-Pesa caps a single payment at ${MAX_AMOUNT.toLocaleString()}.`;

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (disabled) return;
    if (!validate()) return;

    const ok = await onSend({
      phoneNumber: normalized,
      amount: Number(amount),
      customerName: name.trim(),
    });

    if (ok) {
      setPhone('');
      setAmount('');
      setName('');
      setErrors({});
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit} noValidate>
      <div className="fields">
        <label className="field field-phone">
          <span className="label">Phone number</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="0712 345 678"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (errors.phone) setErrors((p) => ({ ...p, phone: undefined }));
            }}
            className={errors.phone ? 'input input-error' : 'input'}
          />
          {errors.phone ? <span className="field-error">{errors.phone}</span> : null}
        </label>

        <label className="field field-amount">
          <span className="label">Amount (KES)</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            autoComplete="off"
            placeholder="50"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (errors.amount) setErrors((p) => ({ ...p, amount: undefined }));
            }}
            className={errors.amount ? 'input input-error' : 'input'}
          />
          {errors.amount ? <span className="field-error">{errors.amount}</span> : null}
        </label>

        <label className="field field-name">
          <span className="label">
            Name <span className="optional">optional</span>
          </span>
          <input
            type="text"
            autoComplete="off"
            placeholder="Walk-in"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </label>

        <button type="submit" className="btn btn-send" disabled={disabled}>
          {sending ? 'Sending...' : cooldown > 0 ? `Wait ${cooldown}s` : 'Send STK Push'}
        </button>
      </div>

      {cooldown > 0 ? (
        <p className="form-note">
          A push already went to this number. Give the customer a moment before resending.
        </p>
      ) : null}

      {submitError ? <p className="form-error">{submitError}</p> : null}
    </form>
  );
}
