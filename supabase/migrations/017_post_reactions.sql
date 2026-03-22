-- 017_post_reactions.sql
-- Emoji reactions on posts (❤️ 🧠 🙏 💡 👀).
-- One reaction per emoji per user per post; toggled via POST /api/community/posts/:id/reactions.

CREATE TABLE post_reactions (
  id         bigserial    PRIMARY KEY,
  post_id    bigint       NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    text         NOT NULL,
  emoji      text         NOT NULL CHECK (emoji IN ('❤️', '🧠', '🙏', '💡', '👀')),
  created_at timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, emoji)
);

CREATE INDEX post_reactions_post_id_idx ON post_reactions (post_id);
CREATE INDEX post_reactions_user_id_idx ON post_reactions (user_id);
