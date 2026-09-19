-- ─────────────────────────────────────────────────────────────────────────────
-- Track which bin labels have been printed.
--
-- printed_at is set when a label PDF is saved/shared from the Labels page and
-- can be cleared or set by hand there. Existing RLS on bins already limits
-- writes to the owner, so no policy changes are needed.
-- ─────────────────────────────────────────────────────────────────────────────

alter table bins add column if not exists printed_at timestamptz;
