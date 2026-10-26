import { useEffect, useState } from 'react';
import { api } from '../api';
import { ReasonForm } from '../components/ReasonForm';
import { ago, when } from '../format';
import type { RoleInfo, StaffRow } from '../types';

type Pending =
  | { kind: 'role'; member: StaffRow; role: string }
  | { kind: 'disable' | 'enable'; member: StaffRow };

/**
 * Security → Staff: who may sign in to this console and what their role
 * lets them do (docs/admin-portal.md §5). Each change asks why and is kept
 * in the audit log. Nobody changes their own access.
 */
export function Staff({ myId }: { myId: string }) {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = () =>
    api<{ staff: StaffRow[]; roles: RoleInfo[] }>('/staff').then(
      data => {
        setRows(data.staff);
        setRoles(data.roles);
      },
      err => setError(err.message),
    );
  useEffect(() => {
    load();
  }, []);

  const label = (role: string) => roles.find(r => r.id === role)?.label ?? role;

  return (
    <>
      <div className="page-head">
        <h1>Staff</h1>
        {!adding && (
          <button className="primary" onClick={() => setAdding(true)}>
            Add staff member
          </button>
        )}
      </div>
      <p className="muted">
        Only these Google accounts can sign in. A new person is tied to their
        Google account the first time they sign in.
      </p>
      {error && <p className="notice error">{error}</p>}
      {adding && (
        <AddStaff
          roles={roles}
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(member => {
                const isMe = member.id === myId;
                return (
                  <tr key={member.id}>
                    <td>
                      {member.name && <div>{member.name}</div>}
                      <div className={member.name ? 'muted small' : undefined}>{member.email}</div>
                    </td>
                    <td>
                      {isMe ? (
                        label(member.role)
                      ) : (
                        <select
                          value={member.role}
                          aria-label={`Role for ${member.email}`}
                          disabled={!!pending}
                          onChange={e => setPending({ kind: 'role', member, role: e.target.value })}
                        >
                          {roles.map(r => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {member.status === 'ACTIVE' ? (
                        <span className="badge done">{member.googleLinked ? 'Active' : 'Not signed in yet'}</span>
                      ) : (
                        <span className="badge bad">Disabled</span>
                      )}
                    </td>
                    <td className="nowrap">
                      {member.lastLoginAt ? <span title={when(member.lastLoginAt)}>{ago(member.lastLoginAt)}</span> : '—'}
                    </td>
                    <td className="nowrap">{when(member.createdAt)}</td>
                    <td className="nowrap">
                      {isMe ? (
                        <span className="muted small">You</span>
                      ) : (
                        <button
                          className="secondary"
                          disabled={!!pending}
                          onClick={() =>
                            setPending({ kind: member.status === 'ACTIVE' ? 'disable' : 'enable', member })
                          }
                        >
                          {member.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pending && (
        <section className="panel">
          <ReasonForm
            prompt={
              pending.kind === 'role'
                ? `Change ${pending.member.email} from ${label(pending.member.role)} to ${label(pending.role)}. Why?`
                : pending.kind === 'disable'
                  ? `Disable ${pending.member.email}? They are signed out at once. Why?`
                  : `Let ${pending.member.email} sign in again. Why?`
            }
            confirmLabel={pending.kind === 'role' ? 'Change role' : pending.kind === 'disable' ? 'Disable' : 'Enable'}
            onCancel={() => setPending(null)}
            onSubmit={async reason => {
              if (pending.kind === 'role') {
                await api(`/staff/${pending.member.id}/role`, 'PUT', { role: pending.role, reason });
              } else {
                await api(`/staff/${pending.member.id}/${pending.kind}`, 'POST', { reason });
              }
              setPending(null);
              load();
            }}
          />
        </section>
      )}
      {roles.length > 0 && (
        <section className="panel">
          <h2>Roles</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {roles.map(r => (
                  <tr key={r.id}>
                    <td className="nowrap">
                      <strong>{r.label}</strong>
                    </td>
                    <td>
                      <div>{r.description}</div>
                      <div className="muted small mono">{r.permissions.join(', ')}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function AddStaff({
  roles,
  onCancel,
  onAdded,
}: {
  roles: RoleInfo[];
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('SUPPORT');
  const [confirming, setConfirming] = useState(false);
  const clean = email.trim().toLowerCase();
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  const roleLabel = roles.find(r => r.id === role)?.label ?? role;

  return (
    <section className="panel">
      <h2>Add staff member</h2>
      <form
        className="row"
        onSubmit={e => {
          e.preventDefault();
          setConfirming(true);
        }}
      >
        <input
          type="email"
          placeholder="Their Google email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={confirming}
          autoFocus
        />
        <select value={role} onChange={e => setRole(e.target.value)} disabled={confirming}>
          {roles.map(r => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        {!confirming && (
          <>
            <button className="primary" disabled={!ready}>
              Next
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
      </form>
      {confirming && (
        <ReasonForm
          prompt={`Let ${clean} sign in as ${roleLabel}. Why?`}
          confirmLabel="Add"
          onCancel={() => setConfirming(false)}
          onSubmit={async reason => {
            await api('/staff', 'POST', { email: clean, role, reason });
            onAdded();
          }}
        />
      )}
    </section>
  );
}
