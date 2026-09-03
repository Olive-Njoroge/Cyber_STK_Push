import StatusBadge from './StatusBadge.jsx';
import { formatPhone } from '../phone.js';

const timeFormat = new Intl.DateTimeFormat('en-KE', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export default function TransactionsTable({ transactions, onVerify, verifyingId, checkCooldown, now }) {
  if (transactions.length === 0) {
    return (
      <div className="card empty">
        <p>No payments yet today.</p>
      </div>
    );
  }

  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="col-time">Time</th>
            <th className="col-phone">Phone</th>
            <th className="col-amount">Amount</th>
            <th className="col-status">Status</th>
            <th className="col-detail">Detail</th>
            <th className="col-action" />
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const needsCheck = tx.status === 'PENDING' || tx.status === 'STALE';
            const cooling = (checkCooldown[tx.id] ?? 0) > now;
            const secondsLeft = cooling ? Math.ceil((checkCooldown[tx.id] - now) / 1000) : 0;

            return (
              <tr key={tx.id} className={`row row-${tx.status.toLowerCase()}`}>
                <td className="col-time">{timeFormat.format(new Date(tx.createdAt))}</td>
                <td className="col-phone">
                  {formatPhone(tx.phoneNumber)}
                  {tx.customerName ? <span className="sub">{tx.customerName}</span> : null}
                </td>
                <td className="col-amount">{tx.amount.toLocaleString()}</td>
                <td className="col-status">
                  <StatusBadge status={tx.status} />
                </td>
                <td className="col-detail">
                  {tx.mpesaReceipt ? <strong className="receipt">{tx.mpesaReceipt}</strong> : null}
                  <span className="detail-text">{detailText(tx)}</span>
                </td>
                <td className="col-action">
                  {needsCheck ? (
                    <button
                      type="button"
                      className="btn btn-check"
                      onClick={() => onVerify(tx.id)}
                      disabled={verifyingId === tx.id || cooling}
                    >
                      {verifyingId === tx.id ? 'Checking...' : cooling ? `${secondsLeft}s` : 'Check status'}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function detailText(tx) {
  if (tx.status === 'STALE' && !tx.resultDescription) {
    return 'No answer from PayHero yet. Check the status before letting the customer go.';
  }
  if (tx.status === 'STALE') {
    return `Unknown. ${tx.resultDescription}`;
  }
  return tx.resultDescription || '';
}
