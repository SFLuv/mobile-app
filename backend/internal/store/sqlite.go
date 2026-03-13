package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/sfluv/sfluv-wallet-platform/backend/internal/model"
	_ "modernc.org/sqlite"
)

type SQLiteStore struct {
	db *sql.DB
}

func NewSQLiteStore(path string) (*SQLiteStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir db dir: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	db.SetMaxOpenConns(1)

	s := &SQLiteStore{db: db}
	if err := s.init(); err != nil {
		return nil, err
	}

	return s, nil
}

func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

func (s *SQLiteStore) init() error {
	schema := `
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
`
	_, err := s.db.Exec(schema)
	if err != nil {
		return fmt.Errorf("init schema: %w", err)
	}

	return nil
}

func (s *SQLiteStore) AddUserOp(op model.StoredUserOp) error {
	_, err := s.db.Exec(`
		INSERT OR IGNORE INTO user_ops (user_op_hash, chain_id, sender, tx_hash, status, raw_user_op, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, op.UserOpHash, op.ChainID, op.Sender, op.TxHash, string(op.Status), op.RawUserOp, op.CreatedAt.UTC(), op.UpdatedAt.UTC())
	if err != nil {
		return fmt.Errorf("insert userop: %w", err)
	}
	return nil
}

func (s *SQLiteStore) UpdateUserOpSubmitted(hash, txHash string) error {
	_, err := s.db.Exec(`
		UPDATE user_ops SET tx_hash = ?, status = ?, updated_at = ? WHERE user_op_hash = ?
	`, txHash, string(model.UserOpSubmitted), time.Now().UTC(), hash)
	if err != nil {
		return fmt.Errorf("update userop submitted: %w", err)
	}
	return nil
}

func (s *SQLiteStore) UpdateUserOpStatus(hash string, status model.UserOpStatus) error {
	_, err := s.db.Exec(`
		UPDATE user_ops SET status = ?, updated_at = ? WHERE user_op_hash = ?
	`, string(status), time.Now().UTC(), hash)
	if err != nil {
		return fmt.Errorf("update userop status: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetUserOp(hash string) (*model.StoredUserOp, error) {
	row := s.db.QueryRow(`
		SELECT user_op_hash, chain_id, sender, tx_hash, status, raw_user_op, created_at, updated_at
		FROM user_ops WHERE user_op_hash = ?
	`, hash)

	var op model.StoredUserOp
	var status string
	if err := row.Scan(&op.UserOpHash, &op.ChainID, &op.Sender, &op.TxHash, &status, &op.RawUserOp, &op.CreatedAt, &op.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get userop: %w", err)
	}
	op.Status = model.UserOpStatus(status)
	return &op, nil
}

func (s *SQLiteStore) ListActivityByAccount(chainID int64, account string, limit int) ([]model.ActivityItem, error) {
	rows, err := s.db.Query(`
		SELECT user_op_hash, tx_hash, status, sender, created_at
		FROM user_ops
		WHERE chain_id = ? AND sender = ?
		ORDER BY created_at DESC
		LIMIT ?
	`, chainID, account, limit)
	if err != nil {
		return nil, fmt.Errorf("activity query: %w", err)
	}
	defer rows.Close()

	items := []model.ActivityItem{}
	for rows.Next() {
		var item model.ActivityItem
		var status string
		if err := rows.Scan(&item.UserOpHash, &item.TxHash, &status, &item.From, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("activity scan: %w", err)
		}
		item.Type = "userop"
		item.Status = model.UserOpStatus(status)
		items = append(items, item)
	}
	return items, nil
}

func (s *SQLiteStore) UpsertPushDevice(device model.PushDevice) error {
	_, err := s.db.Exec(`
		INSERT INTO push_devices (chain_id, account, platform, token, app_version, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(chain_id, account, token) DO UPDATE SET
			platform = excluded.platform,
			app_version = excluded.app_version,
			created_at = excluded.created_at
	`, device.ChainID, device.Account, device.Platform, device.Token, device.AppVersion, device.CreatedAt.UTC())
	if err != nil {
		return fmt.Errorf("upsert push: %w", err)
	}
	return nil
}

func (s *SQLiteStore) DeletePushDevice(chainID int64, account, token string) error {
	_, err := s.db.Exec(`
		DELETE FROM push_devices WHERE chain_id = ? AND account = ? AND token = ?
	`, chainID, account, token)
	if err != nil {
		return fmt.Errorf("delete push: %w", err)
	}
	return nil
}
