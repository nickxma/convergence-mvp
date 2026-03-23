-- 078_claw_machines_inventory.sql
-- Extend claw_machines with inventory fields required by the admin API:
--   location, prize_stock_count, credits_per_play, mqtt_topic,
--   last_heartbeat_at (for 60-second offline detection), prize_stock_threshold.
--
-- Used by:
--   /api/admin/machines        (CRUD)
--   /api/machines              (public, online-only)
--   /api/machines/:id/heartbeat (hardware check-in)

ALTER TABLE claw_machines
  ADD COLUMN IF NOT EXISTS location            TEXT,
  ADD COLUMN IF NOT EXISTS prize_stock_count   INT  NOT NULL DEFAULT 0 CHECK (prize_stock_count >= 0),
  ADD COLUMN IF NOT EXISTS credits_per_play    INT  NOT NULL DEFAULT 10 CHECK (credits_per_play > 0),
  ADD COLUMN IF NOT EXISTS mqtt_topic          TEXT,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prize_stock_threshold INT NOT NULL DEFAULT 5 CHECK (prize_stock_threshold >= 0);

-- Index for heartbeat staleness queries (find machines to mark offline)
CREATE INDEX IF NOT EXISTS claw_machines_heartbeat
  ON claw_machines (last_heartbeat_at)
  WHERE status = 'online';

-- Function: mark machines offline when heartbeat is stale (> 60 s ago or null)
-- Called from the heartbeat-check route and on admin/public GET requests.
CREATE OR REPLACE FUNCTION mark_stale_machines_offline()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE claw_machines
  SET    status = 'offline'
  WHERE  status = 'online'
    AND  (last_heartbeat_at IS NULL
          OR last_heartbeat_at < NOW() - INTERVAL '60 seconds');
$$;
