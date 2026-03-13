package events

import (
	"encoding/json"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	mu    sync.RWMutex
	subs  map[string]map[*websocket.Conn]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: map[string]map[*websocket.Conn]struct{}{}}
}

func normalizeAccount(account string) string {
	return strings.ToLower(account)
}

func (h *Hub) Subscribe(account string, conn *websocket.Conn) {
	account = normalizeAccount(account)
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subs[account]; !ok {
		h.subs[account] = map[*websocket.Conn]struct{}{}
	}
	h.subs[account][conn] = struct{}{}
}

func (h *Hub) Unsubscribe(account string, conn *websocket.Conn) {
	account = normalizeAccount(account)
	h.mu.Lock()
	defer h.mu.Unlock()
	if conns, ok := h.subs[account]; ok {
		delete(conns, conn)
		if len(conns) == 0 {
			delete(h.subs, account)
		}
	}
}

func (h *Hub) Broadcast(account string, payload any) {
	account = normalizeAccount(account)
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}

	h.mu.RLock()
	conns := h.subs[account]
	h.mu.RUnlock()

	for c := range conns {
		_ = c.WriteMessage(websocket.TextMessage, b)
	}
}
