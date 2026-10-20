-- The ledger's rules, enforced by the database itself (docs/ledger.md), so
-- no code path, script or console can break them.

-- 1. Append-only: ledger rows are never edited or deleted. A mistake is
--    corrected by a new entry that reverses it.
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The ledger is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_append_only BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint

-- 2. Every entry balances: its lines add up to zero. Checked at commit
--    (deferred), once all of an entry's lines have been added.
CREATE FUNCTION ledger_entry_balances() RETURNS trigger AS $$
DECLARE
  total bigint;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO total FROM ledger_lines WHERE entry_id = NEW.entry_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'Ledger entry % does not balance (off by % cents)', NEW.entry_id, total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_lines_balance AFTER INSERT ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_balances();
--> statement-breakpoint

-- 3. No empty lines.
ALTER TABLE ledger_lines ADD CONSTRAINT ledger_lines_nonzero CHECK (amount <> 0);
