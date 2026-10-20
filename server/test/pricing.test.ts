import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG } from '../../src/domain/pricing/catalog';
import { createDatabase, type Database } from '../src/db/client';
import { adminHarness } from './adminHarness';
import { booking, BRIAN, REPAIR, SERVICE, WANJIRU } from './fixtures';

let db: Database;
let close: () => Promise<void>;
let h: ReturnType<typeof adminHarness>;

beforeAll(async () => {
  ({ db, close } = await createDatabase());
  h = adminHarness(db);
});
beforeEach(() => h.reset());
afterAll(async () => {
  await h.app.close();
  await close();
});

const estimate = (details: object) => h.appOk('POST', '/pricing/estimate', WANJIRU, details);
const vehicle = (v: object) => ({ ...SERVICE, vehicle: { ...SERVICE.vehicle, ...v } });

describe('prices by vehicle class', () => {
  it('classes a car by make, by what the customer said, then by its model', async () => {
    const classOf = async (v: object) => (await estimate(vehicle(v))).fixedService.vehicleClass;
    expect(await classOf({})).toBe('SMALL'); // Fielder: 1,500 cc in the model list
    expect(await classOf({ engineCc: 1800 })).toBe('MEDIUM'); // the customer knows better
    expect(await classOf({ make: 'Toyota', model: 'Prado' })).toBe('FOUR_X4'); // diesel
    expect(await classOf({ make: 'Mercedes-Benz', model: 'C200' })).toBe('PREMIUM');
    expect(await classOf({ make: 'Unknown', model: 'Car' })).toBe('MEDIUM');
  });

  it('separates labour from the optional parts', async () => {
    const { fixedService } = await estimate(SERVICE); // oil change, small car
    expect(fixedService).toMatchObject({
      serviceTotal: 80_000, // labour KSh 800
      partsTotal: 490_000, // 4 L oil at KSh 1,000 + filter KSh 900
      partsOption: 'MECHANIC',
      total: 570_000,
    });
    const own = await estimate({ ...SERVICE, partsOption: 'OWN' });
    expect(own.fixedService).toMatchObject({ partsOption: 'OWN', total: 80_000 });
  });
});

describe('parts on a fixed-price job', () => {
  it('without parts: charges labour only, and the quote has no parts', async () => {
    const job = await h.appOk('POST', '/jobs', WANJIRU, booking({ ...SERVICE, partsOption: 'OWN' }));
    expect(job.partsOption).toBe('OWN');
    const money = await h.appOk('GET', `/jobs/${job.id}/money`, WANJIRU);
    expect(money.charges.map((c: { purpose: string; amount: number }) => [c.purpose, c.amount])).toEqual([
      ['CALL_OUT', 80_000],
      ['SERVICE', 80_000],
    ]);
    const [quote] = await h.appOk('GET', `/jobs/${job.id}/quotes`, WANJIRU);
    expect(quote.items.every((i: { kind: string }) => i.kind !== 'PART')).toBe(true);
  });

  it('with parts: one prompt, parts paid out at once at 5%, labour held until confirmed at 20%', async () => {
    const id = await h.arrived(SERVICE);
    await h.appOk('POST', `/jobs/${id}/ready-to-start`, BRIAN);
    const payment = await h.pay(id);
    expect(payment).toMatchObject({ purpose: 'SERVICE', amount: 570_000, partsAmount: 490_000 });

    // The mechanic has the parts money before starting.
    let releases = await h.appOk('GET', '/provider/releases', BRIAN);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ gross: 490_000, commission: 24_500, net: 465_500 });
    expect(releases[0].lines).toEqual([
      { paymentId: payment.id, purpose: 'PARTS', gross: 490_000, commission: 24_500 },
    ]);

    await h.appOk('POST', `/jobs/${id}/complete`, BRIAN, {});
    await h.appOk('POST', `/jobs/${id}/confirm`, WANJIRU);
    releases = await h.appOk('GET', '/provider/releases', BRIAN);
    const final = releases.find((r: { gross: number }) => r.gross !== 490_000);
    // Call-out KSh 800 + labour KSh 800, 20% each; the parts aren't paid twice.
    expect(final).toMatchObject({ gross: 160_000, commission: 32_000, net: 128_000 });

    const detail = await h.staffOk('GET', `/jobs/${id}`);
    expect(detail.money).toMatchObject({ paid: 650_000, heldInEscrow: 0, commission: 56_500 });
  });

  it('uses the live commission rates', async () => {
    await h.staffOk('PUT', '/settings/commission_parts_bps', { value: 0, reason: 'Launch offer on parts' });
    const id = await h.arrived(SERVICE);
    await h.appOk('POST', `/jobs/${id}/ready-to-start`, BRIAN);
    await h.pay(id);
    const [release] = await h.appOk('GET', '/provider/releases', BRIAN);
    expect(release).toMatchObject({ gross: 490_000, commission: 0 });
  });
});

describe('editing the catalog', () => {
  const oil = () => structuredClone(DEFAULT_CATALOG.packages.find(p => p.id === 'oil_service')!);

  it('changes the price of new bookings only, and keeps every version', async () => {
    const before = await h.appOk('POST', '/jobs', WANJIRU, booking(SERVICE));
    const { versionId } = await h.staffOk('GET', '/catalog');
    expect(versionId).toBeNull(); // still the starting catalog

    const pkg = oil();
    pkg.items[0].prices.SMALL = { quantity: 1, unitPrice: 100_000 }; // labour KSh 1,000
    const saved = await h.staffOk('PUT', '/catalog/packages/oil_service', {
      baseVersionId: null,
      reason: 'Labour rates went up',
      package: pkg,
    });
    expect((await estimate(SERVICE)).fixedService.serviceTotal).toBe(100_000);

    // The earlier booking keeps the price it was booked at.
    const [quote] = await h.appOk('GET', `/jobs/${before.id}/quotes`, WANJIRU);
    expect(quote.total).toBe(570_000);

    // A booking at the old price is refused: the customer must see the new one.
    const stale = await h.app.inject({ method: 'POST', url: '/jobs', headers: WANJIRU, payload: booking(SERVICE) });
    expect(stale.statusCode).toBe(409);

    const catalog = await h.staffOk('GET', '/catalog');
    expect(catalog.versionId).toBe(saved.versionId);
    expect(catalog.history[0]).toMatchObject({
      summary: 'Oil & filter change: updated',
      reason: 'Labour rates went up',
      staffEmail: 'owner@example.com',
    });
  });

  it('refuses a save made from an outdated version', async () => {
    const save = (baseVersionId: string | null) =>
      h.staff('PUT', '/catalog/packages/oil_service', { baseVersionId, reason: 'Price review', package: oil() });
    expect((await save(null)).statusCode).toBe(200);
    const res = await save(null); // someone saved in between
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('catalog_changed');
  });

  it('refuses a package without labour, or with a bad price', async () => {
    const partsOnly = { ...oil(), items: oil().items.filter(i => i.kind === 'PART') };
    let res = await h.staff('PUT', '/catalog/packages/oil_service', { baseVersionId: null, reason: 'Testing it', package: partsOnly });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/labour/);

    const cents = oil();
    cents.items[0].prices.SMALL = { quantity: 1, unitPrice: 80_050 }; // KSh 800.50
    res = await h.staff('PUT', '/catalog/packages/oil_service', { baseVersionId: null, reason: 'Testing it', package: cents });
    expect(res.statusCode).toBe(400);
  });

  it('adds a package, turns one off, and restores an old version', async () => {
    const battery = {
      id: 'battery_service',
      name: 'Battery check & fit',
      active: true,
      items: [{ serviceCode: 'LABOUR_BATTERY', kind: 'LABOUR', description: 'Fit battery', prices: { SMALL: { quantity: 1, unitPrice: 50_000 } } }],
    };
    const first = await h.staffOk('PUT', '/catalog/packages/battery_service', { baseVersionId: null, reason: 'New package', package: battery });
    expect((await estimate({ ...SERVICE, categoryId: 'battery_service' })).pricingMode).toBe('FIXED');
    // Only priced for small cars: a large one is quoted by the mechanic.
    expect((await estimate({ ...vehicle({ make: 'Toyota', model: 'Harrier' }), categoryId: 'battery_service' })).pricingMode).toBe('QUOTED');

    const off = await h.staffOk('PUT', '/catalog/packages/oil_service', {
      baseVersionId: first.versionId,
      reason: 'Pausing oil changes',
      package: { ...oil(), active: false },
    });
    expect((await estimate(SERVICE)).pricingMode).toBe('QUOTED');

    await h.staffOk('POST', `/catalog/versions/${first.versionId}/restore`, {
      baseVersionId: off.versionId,
      reason: 'Oil changes are back',
    });
    expect((await estimate(SERVICE)).pricingMode).toBe('FIXED');
  });

  it('edits the model list and the premium makes', async () => {
    await h.staffOk('PUT', '/catalog/models', {
      baseVersionId: null,
      reason: 'Fielder hybrid is common',
      models: [{ make: 'Toyota', model: 'Fielder', engineCc: 1500, fuel: 'diesel' }],
    });
    expect((await estimate(SERVICE)).fixedService.vehicleClass).toBe('FOUR_X4');

    const dupes = await h.staff('PUT', '/catalog/models', {
      baseVersionId: (await h.staffOk('GET', '/catalog')).versionId,
      reason: 'Adding twice',
      models: [
        { make: 'Toyota', model: 'Vitz', engineCc: 1000, fuel: 'petrol' },
        { make: 'toyota', model: 'vitz', engineCc: 1000, fuel: 'petrol' },
      ],
    });
    expect(dupes.statusCode).toBe(400);

    await h.staffOk('PUT', '/catalog/premium-makes', {
      baseVersionId: (await h.staffOk('GET', '/catalog')).versionId,
      reason: 'Toyota is premium now?',
      premiumMakes: ['Toyota'],
    });
    expect((await estimate(SERVICE)).fixedService.vehicleClass).toBe('PREMIUM');
  });

  it('previews a price for any vehicle', async () => {
    const preview = await h.staffOk('POST', '/catalog/preview', {
      categoryId: 'routine_service',
      vehicle: { make: 'Toyota', model: 'Prado' },
    });
    expect(preview.classification).toEqual({ vehicleClass: 'FOUR_X4', source: 'model_lookup' });
    expect(preview.fixedService.parts.length).toBeGreaterThan(0);
  });

  it('is only for staff', async () => {
    expect((await h.app.inject({ url: '/admin/catalog' })).statusCode).toBe(401);
    expect((await h.app.inject({ url: '/admin/catalog', headers: WANJIRU })).statusCode).toBe(401);
  });
});

describe('repairs are unchanged', () => {
  it('still quote with no parts option', async () => {
    const res = await estimate({ ...REPAIR, partsOption: 'OWN' });
    expect(res).toEqual({ pricingMode: 'QUOTED', callOut: 80_000 });
  });
});
