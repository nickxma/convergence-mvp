-- Add cached_tokens column to openai_usage for OpenAI prompt caching visibility.
-- OpenAI returns usage.prompt_tokens_details.cached_tokens when a prompt prefix is served
-- from cache. Storing this allows us to measure cache hit rate in the admin costs view.

ALTER TABLE openai_usage
  ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;
