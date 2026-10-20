import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  VEHICLE_CLASSES,
  type CatalogItem,
  type CatalogPackage,
  type CatalogPage,
  type Fuel,
  type ItemKind,
  type ModelSpec,
  type PricePreview,
  type VehicleClass,
} from '../api';
import { ReasonForm } from '../components/ReasonForm';
import { ksh, when } from '../format';

type Tab = 'packages' | 'models' | 'premium' | 'check' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'packages', label: 'Packages' },
  { id: 'models', label: 'Vehicle models' },
  { id: 'premium', label: 'Premium makes' },
  { id: 'check', label: 'Price check' },
  { id: 'history', label: 'History' },
];

const SHORT_CLASS: Record<VehicleClass, string> = {
  SMALL: 'Small',
  MEDIUM: 'Medium',
  LARGE: 'Large / SUV',
  FOUR_X4: '4x4 / diesel',
  PREMIUM: 'Premium',
};

const FUELS: Fuel[] = ['petrol', 'diesel', 'hybrid', 'electric'];

const isPart = (kind: ItemKind) => kind === 'PART';

/**
 * Configuration → Catalog: the fixed prices for maintenance. Labour is
 * priced per vehicle class; parts are optional for the customer. Every
 * save is a new version, kept in History, and can be restored.
 */
export function Catalog() {
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('packages');

  const load = () =>
    api<CatalogPage>('/catalog').then(
      p => {
        setPage(p);
        setError(null);
      },
      err => setError(err.message),
    );
  useEffect(() => {
    load();
  }, []);

  /** Every save goes through here, naming the version it started from. */
  const save = async (path: string, body: object, method = 'PUT') => {
    await api(path, method, { ...body, baseVersionId: page!.versionId });
    await load();
  };

  return (
    <>
      <div className="page-head">
        <h1>Catalog</h1>
        <div className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        Fixed prices for maintenance. Fundi-X sets the labour for each vehicle class; parts are
        optional, and customers who bring their own pay labour only. Changes apply to new
        bookings straight away; booked jobs keep their price.
      </p>
      {error && <p className="notice error">{error}</p>}
      {!page && !error && <p className="muted">Loading…</p>}
      {page && (
        <>
          <p className="muted small">
            {page.versionId
              ? `Live version saved ${when(page.history[0]?.createdAt ?? '')} by ${page.history[0]?.staffEmail ?? 'unknown'}.`
              : 'Using the starting catalog: nothing has been changed yet.'}
          </p>
          {tab === 'packages' && <Packages page={page} save={save} />}
          {tab === 'models' && <Models page={page} save={save} />}
          {tab === 'premium' && <PremiumMakes page={page} save={save} />}
          {tab === 'check' && <PriceCheck page={page} />}
          {tab === 'history' && <History page={page} save={save} />}
        </>
      )}
    </>
  );
}

type Save = (path: string, body: object, method?: string) => Promise<void>;
type SectionProps = { page: CatalogPage; save: Save };

// ---- Packages -----------------------------------------------------------

function Packages({ page, save }: SectionProps) {
  const [adding, setAdding] = useState(false);
  const ids = page.catalog.packages.map(p => p.id);
  return (
    <>
      {page.catalog.packages.map(pkg => (
        <PackagePanel key={pkg.id} pkg={pkg} page={page} save={save} />
      ))}
      {adding ? (
        <PackagePanel
          pkg={{ id: '', name: '', active: true, items: [] }}
          page={page}
          save={save}
          isNew
          takenIds={ids}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button className="secondary" onClick={() => setAdding(true)}>
          Add a package
        </button>
      )}
    </>
  );
}

function PackagePanel({
  pkg,
  page,
  save,
  isNew = false,
  takenIds = [],
  onDone,
}: SectionProps & { pkg: CatalogPackage; isNew?: boolean; takenIds?: string[]; onDone?: () => void }) {
  const [draft, setDraft] = useState<CatalogPackage | null>(isNew ? structuredClone(pkg) : null);
  const [confirming, setConfirming] = useState(false);
  const editing = draft !== null;
  const shown = draft ?? pkg;

  const stop = () => {
    setDraft(null);
    setConfirming(false);
    onDone?.();
  };
  const update = (change: (p: CatalogPackage) => void) =>
    setDraft(d => {
      const next = structuredClone(d!);
      change(next);
      return next;
    });

  const idTaken = isNew && takenIds.includes(shown.id);

  return (
    <section className="panel">
      <div className="panel-head">
        {editing ? (
          <div className="row">
            <input
              className="search"
              value={shown.name}
              placeholder="Package name, e.g. Battery check & fit"
              onChange={e => update(p => (p.name = e.target.value))}
              aria-label="Package name"
            />
            {isNew && (
              <input
                className="search mono"
                value={shown.id}
                placeholder="id, e.g. battery_service"
                onChange={e => update(p => (p.id = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')))}
                aria-label="Package id"
              />
            )}
            <label className="row small">
              <input
                type="checkbox"
                checked={shown.active}
                onChange={e => update(p => (p.active = e.target.checked))}
              />
              Offered at a fixed price
            </label>
          </div>
        ) : (
          <div>
            <h2>
              {pkg.name}{' '}
              <span className={pkg.active ? 'badge done' : 'badge'}>{pkg.active ? 'Fixed price' : 'Off: quoted'}</span>
            </h2>
            <span className="muted small mono">{pkg.id}</span>
          </div>
        )}
        {!editing && (
          <button className="secondary" onClick={() => setDraft(structuredClone(pkg))}>
            Edit
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="price-grid">
          <thead>
            <tr>
              <th>Line</th>
              {VEHICLE_CLASSES.map(c => (
                <th key={c} className="num">
                  {SHORT_CLASS[c]}
                </th>
              ))}
              {editing && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.items.map((item, i) => (
              <tr key={i}>
                <td>
                  {editing ? (
                    <input
                      className="cell-input wide"
                      value={item.description}
                      onChange={e => update(p => (p.items[i].description = e.target.value))}
                      aria-label="Line description"
                    />
                  ) : (
                    item.description
                  )}
                  <div className="muted small">
                    <span className={isPart(item.kind) ? 'badge active' : 'badge'}>
                      {isPart(item.kind) ? 'Part · optional' : item.kind === 'LABOUR' ? 'Labour' : 'Always included'}
                    </span>{' '}
                    <span className="mono">{item.serviceCode}</span>
                  </div>
                </td>
                {VEHICLE_CLASSES.map(c => (
                  <td key={c} className="num">
                    {editing ? (
                      <PriceCell
                        price={item.prices[c]}
                        unit={item.kind === 'PART'}
                        onChange={price =>
                          update(p => {
                            if (price) {
                              p.items[i].prices[c] = price;
                            } else {
                              delete p.items[i].prices[c];
                            }
                          })
                        }
                      />
                    ) : (
                      <PriceText price={item.prices[c]} />
                    )}
                  </td>
                ))}
                {editing && (
                  <td>
                    <button className="link" onClick={() => update(p => p.items.splice(i, 1))}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
            <TotalsRow pkg={shown} />
          </tbody>
        </table>
      </div>

      {editing && (
        <>
          <AddLine
            codes={page.serviceCodes}
            onAdd={line => update(p => p.items.push(line))}
          />
          <p className="muted small">
            Empty price: the line isn't needed for that class. A class with no lines at all is
            quoted by the mechanic instead. Set part prices about 5% above what mechanics pay.
          </p>
          {confirming ? (
            <ReasonForm
              prompt={`Save ${shown.name || 'this package'}. Why?`}
              confirmLabel="Save"
              onCancel={() => setConfirming(false)}
              onSubmit={async reason => {
                await save(`/catalog/packages/${encodeURIComponent(shown.id)}`, { reason, package: shown });
                stop();
              }}
            />
          ) : (
            <div className="row">
              <button
                className="primary"
                disabled={!shown.name.trim() || !shown.id || idTaken || shown.items.length === 0}
                onClick={() => setConfirming(true)}
              >
                Save…
              </button>
              <button className="secondary" onClick={stop}>
                Cancel
              </button>
              {idTaken && <span className="error small">That id is already used.</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PriceText({ price }: { price?: { quantity: number; unitPrice: number } }) {
  if (!price) {
    return <span className="muted">—</span>;
  }
  return (
    <>
      {ksh(price.quantity * price.unitPrice)}
      {price.quantity > 1 && (
        <div className="muted small">
          {price.quantity} × {ksh(price.unitPrice)}
        </div>
      )}
    </>
  );
}

/**
 * Quantity (for parts) and price in shillings; an empty price means the
 * line isn't needed for that class. Controlled by the package draft, so
 * removing a line can't leave stale numbers behind.
 */
function PriceCell({
  price,
  unit,
  onChange,
}: {
  price?: { quantity: number; unitPrice: number };
  unit: boolean;
  onChange: (price?: { quantity: number; unitPrice: number }) => void;
}) {
  const digits = (text: string) => Number(text.replace(/[^\d]/g, ''));
  return (
    <div className="price-cell">
      {unit && (
        <input
          className="cell-input qty"
          inputMode="numeric"
          value={price?.quantity ?? 1}
          disabled={!price}
          title="Quantity"
          aria-label="Quantity"
          onChange={e => price && onChange({ ...price, quantity: Math.max(1, digits(e.target.value)) })}
        />
      )}
      {unit && <span className="muted small">×</span>}
      <input
        className="cell-input"
        inputMode="numeric"
        value={price ? price.unitPrice / 100 : ''}
        placeholder="—"
        title="Price in shillings"
        aria-label="Price in shillings"
        onChange={e => {
          const shillings = digits(e.target.value);
          onChange(shillings > 0 ? { quantity: price?.quantity ?? 1, unitPrice: shillings * 100 } : undefined);
        }}
      />
    </div>
  );
}

/** Labour (always paid) and parts (optional) per class. */
function TotalsRow({ pkg }: { pkg: CatalogPackage }) {
  const total = (c: VehicleClass, parts: boolean) =>
    pkg.items
      .filter(i => isPart(i.kind) === parts)
      .reduce((s, i) => s + (i.prices[c] ? i.prices[c]!.quantity * i.prices[c]!.unitPrice : 0), 0);
  return (
    <tr className="totals">
      <td>
        <strong>Customer pays</strong>
        <div className="muted small">labour + parts (if the mechanic brings them)</div>
      </td>
      {VEHICLE_CLASSES.map(c => (
        <td key={c} className="num">
          <strong>{ksh(total(c, false))}</strong>
          {total(c, true) > 0 && <div className="muted small">+ {ksh(total(c, true))} parts</div>}
        </td>
      ))}
    </tr>
  );
}

function AddLine({
  codes,
  onAdd,
}: {
  codes: CatalogPage['serviceCodes'];
  onAdd: (item: CatalogItem) => void;
}) {
  const [code, setCode] = useState('');
  return (
    <div className="row add-line">
      <select value={code} onChange={e => setCode(e.target.value)} aria-label="Service code">
        <option value="">Add a line…</option>
        {(['LABOUR', 'PART', 'CONSUMABLE'] as const).map(kind => (
          <optgroup key={kind} label={kind === 'PART' ? 'Parts (optional)' : kind === 'LABOUR' ? 'Labour' : 'Always included'}>
            {codes
              .filter(c => c.kind === kind)
              .map(c => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <button
        className="secondary"
        disabled={!code}
        onClick={() => {
          const known = codes.find(c => c.code === code)!;
          onAdd({ serviceCode: known.code, kind: known.kind, description: known.label, prices: {} });
          setCode('');
        }}
      >
        Add
      </button>
    </div>
  );
}

// ---- Vehicle models -----------------------------------------------------

function Models({ page, save }: SectionProps) {
  const [rows, setRows] = useState<ModelSpec[]>(page.catalog.models);
  const [filter, setFilter] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setRows(page.catalog.models), [page]);

  const changed = JSON.stringify(rows) !== JSON.stringify(page.catalog.models);
  const term = filter.trim().toLowerCase();
  const set = (i: number, change: Partial<ModelSpec>) =>
    setRows(r => r.map((m, j) => (j === i ? { ...m, ...change } : m)));

  return (
    <section className="panel">
      <p className="muted">
        Each model's usual engine, used when the customer doesn't give theirs. Diesel or over
        3,000 cc is 4x4 / diesel; over 2,000 cc is large; over 1,500 cc is medium. Cars not
        listed are priced as medium.
      </p>
      <div className="filters">
        <input className="search" type="search" placeholder="Find a make or model" value={filter} onChange={e => setFilter(e.target.value)} />
        <button
          className="secondary"
          onClick={() => {
            setFilter('');
            setRows(r => [...r, { make: '', model: '', engineCc: 1500, fuel: 'petrol' }]);
          }}
        >
          Add a model
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Make</th>
              <th>Model</th>
              <th>Engine (cc)</th>
              <th>Fuel</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) =>
              term && !`${m.make} ${m.model}`.toLowerCase().includes(term) ? null : (
                <tr key={i}>
                  <td>
                    <input className="cell-input wide" value={m.make} onChange={e => set(i, { make: e.target.value })} aria-label="Make" />
                  </td>
                  <td>
                    <input className="cell-input wide" value={m.model} onChange={e => set(i, { model: e.target.value })} aria-label="Model" />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      inputMode="numeric"
                      value={m.engineCc}
                      onChange={e => set(i, { engineCc: Number(e.target.value.replace(/[^\d]/g, '')) })}
                      aria-label="Engine size in cc"
                    />
                  </td>
                  <td>
                    <select value={m.fuel} onChange={e => set(i, { fuel: e.target.value as Fuel })} aria-label="Fuel">
                      {FUELS.map(f => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="link" onClick={() => setRows(r => r.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {confirming ? (
        <ReasonForm
          prompt="Save the model list. Why?"
          confirmLabel="Save"
          onCancel={() => setConfirming(false)}
          onSubmit={async reason => {
            await save('/catalog/models', { reason, models: rows });
            setConfirming(false);
          }}
        />
      ) : (
        <div className="row">
          <button className="primary" disabled={!changed} onClick={() => setConfirming(true)}>
            Save…
          </button>
          {changed && (
            <button className="secondary" onClick={() => setRows(page.catalog.models)}>
              Undo changes
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---- Premium makes ------------------------------------------------------

function PremiumMakes({ page, save }: SectionProps) {
  const current = page.catalog.premiumMakes.join(', ');
  const [text, setText] = useState(current);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setText(current), [current]);
  const makes = text.split(',').map(m => m.trim()).filter(Boolean);

  return (
    <section className="panel">
      <p className="muted">
        Makes always priced as premium, whatever the engine: their parts and labour cost more.
        Separate with commas.
      </p>
      <textarea
        rows={2}
        value={text}
        onChange={e => setText(e.target.value)}
        className="full"
        aria-label="Premium makes"
      />
      {confirming ? (
        <ReasonForm
          prompt="Save the premium makes. Why?"
          confirmLabel="Save"
          onCancel={() => setConfirming(false)}
          onSubmit={async reason => {
            await save('/catalog/premium-makes', { reason, premiumMakes: makes });
            setConfirming(false);
          }}
        />
      ) : (
        <button className="primary" disabled={text.trim() === current} onClick={() => setConfirming(true)}>
          Save…
        </button>
      )}
    </section>
  );
}

// ---- Price check --------------------------------------------------------

const SOURCE: Record<PricePreview['classification']['source'], string> = {
  make: 'premium make',
  vehicle: 'from the engine given',
  model_lookup: "from the model's usual engine",
  default: 'not in the model list: priced as medium',
};

function PriceCheck({ page }: { page: CatalogPage }) {
  const [categoryId, setCategoryId] = useState(page.catalog.packages[0]?.id ?? '');
  const [make, setMake] = useState('Toyota');
  const [model, setModel] = useState('Fielder');
  const [engineCc, setEngineCc] = useState('');
  const [fuel, setFuel] = useState<Fuel | ''>('');
  const [result, setResult] = useState<PricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setError(null);
    try {
      setResult(
        await api<PricePreview>('/catalog/preview', 'POST', {
          categoryId,
          vehicle: {
            make,
            model,
            ...(engineCc && { engineCc: Number(engineCc) }),
            ...(fuel && { fuel }),
          },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check the price.');
    }
  }

  const service = result?.fixedService;
  return (
    <section className="panel">
      <p className="muted">What a customer would see right now, with the live catalog.</p>
      <form
        className="filters"
        onSubmit={e => {
          e.preventDefault();
          check();
        }}
      >
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)} aria-label="Package">
          {page.catalog.packages.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input className="search" value={make} onChange={e => setMake(e.target.value)} placeholder="Make" aria-label="Make" />
        <input className="search" value={model} onChange={e => setModel(e.target.value)} placeholder="Model" aria-label="Model" />
        <input
          className="search"
          inputMode="numeric"
          value={engineCc}
          onChange={e => setEngineCc(e.target.value.replace(/[^\d]/g, ''))}
          placeholder="Engine cc (optional)"
          aria-label="Engine size in cc"
        />
        <select value={fuel} onChange={e => setFuel(e.target.value as Fuel | '')} aria-label="Fuel">
          <option value="">Fuel unknown</option>
          {FUELS.map(f => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <button className="primary" disabled={!make.trim() || !model.trim()}>
          Check
        </button>
      </form>
      {error && <p className="notice error">{error}</p>}
      {result && (
        <>
          <p>
            <strong>{SHORT_CLASS[result.classification.vehicleClass]}</strong>{' '}
            <span className="muted">({SOURCE[result.classification.source]})</span>
          </p>
          {!service && <p className="notice">Not fixed-priced for this vehicle: the mechanic will quote on site.</p>}
          {service && (
            <div className="table-wrap">
              <table>
                <tbody>
                  {[...service.items, ...service.parts].map((l, i) => (
                    <tr key={i}>
                      <td>
                        {l.description}
                        {isPart(l.kind) && <span className="muted small"> · optional part</span>}
                      </td>
                      <td className="num">
                        {l.quantity > 1 && <span className="muted small">{l.quantity} × {ksh(l.unitPrice)} = </span>}
                        {ksh(l.quantity * l.unitPrice)}
                      </td>
                    </tr>
                  ))}
                  <tr className="totals">
                    <td>Labour only (customer's own parts)</td>
                    <td className="num">{ksh(service.serviceTotal)}</td>
                  </tr>
                  <tr className="totals">
                    <td>With parts from the mechanic</td>
                    <td className="num">{ksh(service.serviceTotal + service.partsTotal)}</td>
                  </tr>
                  <tr>
                    <td className="muted">Plus call-out, paid at booking</td>
                    <td className="num muted">{ksh(result.callOut)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---- History ------------------------------------------------------------

function History({ page, save }: SectionProps) {
  const [restoring, setRestoring] = useState<string | null>(null);
  if (page.history.length === 0) {
    return <p className="muted">No changes yet: the starting catalog is live.</p>;
  }
  return (
    <section className="panel">
      <ul className="activity">
        {page.history.map((v, i) => (
          <li key={v.id}>
            <span>
              <strong>{v.summary}</strong>
              {i === 0 && <span className="badge done">Live</span>}
              <div className="muted small">
                “{v.reason}” · {v.staffEmail ?? 'unknown'} · {when(v.createdAt)}
              </div>
            </span>
            {i > 0 &&
              (restoring === v.id ? (
                <ReasonForm
                  prompt="Make this version live again. Why?"
                  confirmLabel="Restore"
                  onCancel={() => setRestoring(null)}
                  onSubmit={async reason => {
                    await save(`/catalog/versions/${v.id}/restore`, { reason }, 'POST');
                    setRestoring(null);
                  }}
                />
              ) : (
                <button className="secondary" onClick={() => setRestoring(v.id)}>
                  Restore
                </button>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
