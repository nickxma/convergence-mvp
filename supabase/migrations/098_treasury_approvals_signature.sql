-- 098_treasury_approvals_signature.sql
-- Supports OLU-885 (PYUSD: multi-sig treasury approval — 2-of-N admin sign-off for large refunds).
--
-- Adds an optional `signature` column to pyusd_refund_approvals so that the
-- treasury approve endpoint can record a cryptographic sign-off alongside the
-- approver wallet address.

alter table pyusd_refund_approvals
  add column if not exists signature text;
