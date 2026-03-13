CREATE TABLE IF NOT EXISTS user_ops (
  user_op_hash TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  sender TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL,
  raw_user_op BLOB NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_ops_sender ON user_ops(chain_id, sender, created_at DESC);

CREATE TABLE IF NOT EXISTS push_devices (
  chain_id INTEGER NOT NULL,
  account TEXT NOT NULL,
  platform TEXT NOT NULL,
  token TEXT NOT NULL,
  app_version TEXT,
  created_at DATETIME NOT NULL,
  PRIMARY KEY(chain_id, account, token)
);
