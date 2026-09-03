const LABELS = {
  PENDING: 'Waiting',
  SUCCESS: 'Paid',
  FAILED: 'Failed',
  STALE: 'Unknown',
};

export default function StatusBadge({ status }) {
  const key = LABELS[status] ? status : 'STALE';
  return <span className={`badge badge-${key.toLowerCase()}`}>{LABELS[key]}</span>;
}
