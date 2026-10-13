import type { JobStatus } from '../api';
import { STATUS } from '../jobStatus';

export function StatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  return <span className={`badge ${s?.tone ?? ''}`}>{s?.label ?? status}</span>;
}
