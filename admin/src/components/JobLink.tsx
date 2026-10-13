import { shortId } from '../format';
import { href } from '../route';

export function JobLink({ id, full = false }: { id: string; full?: boolean }) {
  return (
    <a className="mono" href={href({ page: 'job', id })} title={id}>
      {full ? id : shortId(id)}
    </a>
  );
}
