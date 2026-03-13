package service

import "github.com/sfluv/sfluv-wallet-platform/backend/internal/events"

func (r *Runtime) Hub() *events.Hub {
	return r.hub
}
