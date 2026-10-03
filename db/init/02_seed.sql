CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (email, password_hash) VALUES
  ('admin@test.com', crypt('admin123', gen_salt('bf')));

INSERT INTO user_roles (user_id, role)
SELECT id, 'admin' FROM users WHERE email = 'admin@test.com';