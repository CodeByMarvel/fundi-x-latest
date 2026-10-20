-- Ledger entries for money recorded before the ledger existed, so the books
-- start complete and balanced. Same entries the code writes
-- (server/src/money/records.ts); ids are derived from the record so this
-- can't double-count.

INSERT INTO ledger_entries (id, kind, job_id, payment_id, description, created_at)
SELECT 'led_bf_' || p.id, 'PAYMENT_RECEIVED', p.job_id, p.id,
       'M-Pesa ' || coalesce(p.receipt_number, '?') || ' (recorded before the ledger)', p.updated_at
FROM payments p WHERE p.status = 'SUCCESS';
--> statement-breakpoint
INSERT INTO ledger_lines (id, entry_id, account, amount, created_at)
SELECT 'll_bf_a_' || p.id, 'led_bf_' || p.id, 'mpesa', p.amount, p.updated_at
FROM payments p WHERE p.status = 'SUCCESS'
UNION ALL
SELECT 'll_bf_b_' || p.id, 'led_bf_' || p.id, 'escrow:' || p.job_id, -p.amount, p.updated_at
FROM payments p WHERE p.status = 'SUCCESS';
--> statement-breakpoint

INSERT INTO ledger_entries (id, kind, job_id, release_id, description, created_at)
SELECT 'led_bf_' || r.id, 'RELEASE', r.job_id, r.id, 'Paid out to the mechanic (recorded before the ledger)', r.created_at
FROM releases r;
--> statement-breakpoint
INSERT INTO ledger_lines (id, entry_id, account, amount, created_at)
SELECT 'll_bf_a_' || r.id, 'led_bf_' || r.id, 'escrow:' || r.job_id, r.gross, r.created_at FROM releases r
UNION ALL
SELECT 'll_bf_b_' || r.id, 'led_bf_' || r.id, 'provider:' || r.provider_id, -r.net, r.created_at FROM releases r WHERE r.net <> 0
UNION ALL
SELECT 'll_bf_c_' || r.id || '_' || (line->>'purpose') || '_' || ord, 'led_bf_' || r.id,
       'revenue:' || (line->>'purpose'), -((line->>'commission')::bigint), r.created_at
FROM releases r, jsonb_array_elements(r.lines) WITH ORDINALITY AS l(line, ord)
WHERE (line->>'commission')::bigint <> 0;
--> statement-breakpoint

INSERT INTO ledger_entries (id, kind, job_id, refund_id, payment_id, description, created_at)
SELECT 'led_bf_' || f.id, 'REFUND', f.job_id, f.id, f.payment_id, 'Refund (recorded before the ledger)', f.created_at
FROM refunds f;
--> statement-breakpoint
INSERT INTO ledger_lines (id, entry_id, account, amount, created_at)
SELECT 'll_bf_a_' || f.id, 'led_bf_' || f.id, 'escrow:' || f.job_id, f.amount, f.created_at FROM refunds f
UNION ALL
SELECT 'll_bf_b_' || f.id, 'led_bf_' || f.id, 'customer:' || j.customer_id, -f.amount, f.created_at
FROM refunds f JOIN jobs j ON j.id = f.job_id;
