-- Track number of texts per embedding request to distinguish single vs. batch calls.
-- Batch calls (input_texts_count > 1) indicate the embedBatch code path is active.

ALTER TABLE openai_usage
  ADD COLUMN input_texts_count INTEGER NOT NULL DEFAULT 1;
