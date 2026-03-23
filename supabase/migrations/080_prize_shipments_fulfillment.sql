-- 080_prize_shipments_fulfillment.sql
--
-- Extends prize_shipments with carrier/label/tracking fields needed for
-- EasyPost integration and delivery status tracking.

ALTER TABLE prize_shipments
  ADD COLUMN IF NOT EXISTS carrier              TEXT,          -- 'USPS', 'UPS', 'FedEx', etc.
  ADD COLUMN IF NOT EXISTS service              TEXT,          -- e.g. 'First', 'Priority'
  ADD COLUMN IF NOT EXISTS label_url            TEXT,          -- EasyPost postage label PDF/PNG URL
  ADD COLUMN IF NOT EXISTS tracking_number      TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url         TEXT,
  ADD COLUMN IF NOT EXISTS rate_cents           INTEGER,       -- postage cost in USD cents
  ADD COLUMN IF NOT EXISTS easypost_shipment_id TEXT,         -- EasyPost shipment ID for webhook correlation
  ADD COLUMN IF NOT EXISTS delivery_status      TEXT          -- 'pre_transit','in_transit','delivered','error'
    CHECK (delivery_status IN ('pre_transit','in_transit','out_for_delivery','delivered','error') OR delivery_status IS NULL),
  ADD COLUMN IF NOT EXISTS shipped_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at         TIMESTAMPTZ;

-- Index for webhook lookups by EasyPost shipment ID
CREATE INDEX IF NOT EXISTS prize_shipments_easypost_id
  ON prize_shipments (easypost_shipment_id)
  WHERE easypost_shipment_id IS NOT NULL;

-- Index for user prize history queries
CREATE INDEX IF NOT EXISTS prize_shipments_user_created
  ON prize_shipments (user_id, created_at DESC);

COMMENT ON COLUMN prize_shipments.easypost_shipment_id IS 'EasyPost shipment object ID, used to correlate tracker webhooks';
COMMENT ON COLUMN prize_shipments.rate_cents            IS 'Postage cost charged in USD cents';
COMMENT ON COLUMN prize_shipments.delivery_status       IS 'Live delivery status from EasyPost tracker webhooks';
