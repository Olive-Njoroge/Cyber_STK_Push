import { useCallback, useEffect, useRef, useState } from 'react';
import PaymentForm from './components/PaymentForm.jsx';
import TransactionsTable from './components/TransactionsTable.jsx';
import { api } from './api.js';

const POLL_INTERVAL_MS = 3000;
const POLL_WINDOW_MS = 90000; // Stop polling a row 90s after it was created.
const LIST_REFRESH_MS = 20000;
const RESEND_COOLDOWN_MS = 30000;
const CHECK_COOLDOWN_MS = 5000;

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [verifyingId, setVerifyingId] = useState(null);
  const [checkCooldown, setCheckCooldown] = useState({});
  const [listError, setListError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // One clock for every countdown on the screen.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const upsert = useCallback((tx) => {
    setTransactions((rows) => {
      const i = rows.findIndex((r) => r.id === tx.id);
      if (i === -1) return [tx, ...rows];
      const next = rows.slice();
      next[i] = tx;
      return next;
    });
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const data = await api.listToday();
      setTransactions(data.transactions);
      setListError('');
    } catch (err) {
      setListError(err.message);
    }
  }, []);

  useEffect(() => {
    refreshList();
    const id = setInterval(refreshList, LIST_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshList]);

  // Poll every unresolved row inside its 90 second window.
  const transactionsRef = useRef(transactions);
  transactionsRef.current = transactions;

  useEffect(() => {
    const id = setInterval(async () => {
      const active = transactionsRef.current.filter(
        (tx) => tx.status === 'PENDING' && Date.now() - new Date(tx.createdAt).getTime() < POLL_WINDOW_MS
      );
      if (active.length === 0) return;

      const results = await Promise.allSettled(active.map((tx) => api.get(tx.id)));
      for (const result of results) {
        if (result.status === 'fulfilled') upsert(result.value.transaction);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [upsert]);

  async function handleSend(payload) {
    setSending(true);
    setSubmitError('');
    try {
      const data = await api.create(payload);
      upsert(data.transaction);
      return true;
    } catch (err) {
      setSubmitError(err.message);
      // A failed push still produced a row; show it so the attendant sees why.
      if (err.transaction) upsert(err.transaction);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(id) {
    setVerifyingId(id);
    setListError('');
    try {
      const data = await api.verify(id);
      upsert(data.transaction);
    } catch (err) {
      if (err.transaction) upsert(err.transaction);
      setListError(err.message);
    } finally {
      setVerifyingId(null);
      setCheckCooldown((prev) => ({ ...prev, [id]: Date.now() + CHECK_COOLDOWN_MS }));
    }
  }

  // Derived from the table, so it survives a page reload.
  function cooldownSecondsFor(phoneNumber) {
    const latest = transactions.find((tx) => tx.phoneNumber === phoneNumber);
    if (!latest || latest.status === 'FAILED') return 0;
    const elapsed = now - new Date(latest.createdAt).getTime();
    if (elapsed >= RESEND_COOLDOWN_MS) return 0;
    return Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
  }

  const unresolved = transactions.filter((tx) => tx.status === 'PENDING' || tx.status === 'STALE').length;
  const paidToday = transactions
    .filter((tx) => tx.status === 'SUCCESS')
    .reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <div className="page">
      <header className="header">
        <h1>M-Pesa Counter</h1>
        <div className="totals">
          <span>
            Paid today: <strong>KES {paidToday.toLocaleString()}</strong>
          </span>
          {unresolved > 0 ? <span className="unresolved">{unresolved} unresolved</span> : null}
        </div>
      </header>

      <PaymentForm
        onSend={handleSend}
        sending={sending}
        submitError={submitError}
        cooldownSecondsFor={cooldownSecondsFor}
      />

      {listError ? <p className="list-error">{listError}</p> : null}

      <TransactionsTable
        transactions={transactions}
        onVerify={handleVerify}
        verifyingId={verifyingId}
        checkCooldown={checkCooldown}
        now={now}
      />
    </div>
  );
}
