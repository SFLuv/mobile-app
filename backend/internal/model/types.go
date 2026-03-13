package model

import "time"

type UserOpStatus string

const (
	UserOpPending   UserOpStatus = "pending"
	UserOpSubmitted UserOpStatus = "submitted"
	UserOpSuccess   UserOpStatus = "success"
	UserOpReverted  UserOpStatus = "reverted"
	UserOpTimeout   UserOpStatus = "timeout"
)

type StoredUserOp struct {
	UserOpHash string       `json:"user_op_hash"`
	ChainID    int64        `json:"chain_id"`
	Sender     string       `json:"sender"`
	TxHash     *string      `json:"tx_hash,omitempty"`
	Status     UserOpStatus `json:"status"`
	RawUserOp  []byte       `json:"-"`
	CreatedAt  time.Time    `json:"created_at"`
	UpdatedAt  time.Time    `json:"updated_at"`
}

type ActivityItem struct {
	Type       string       `json:"type"`
	UserOpHash string       `json:"user_op_hash"`
	TxHash     *string      `json:"tx_hash,omitempty"`
	Status     UserOpStatus `json:"status"`
	From       string       `json:"from"`
	To         string       `json:"to,omitempty"`
	Value      string       `json:"value,omitempty"`
	CreatedAt  time.Time    `json:"created_at"`
}

type PushDevice struct {
	ChainID    int64     `json:"chain_id"`
	Account    string    `json:"account"`
	Platform   string    `json:"platform"`
	Token      string    `json:"token"`
	AppVersion string    `json:"app_version,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}
