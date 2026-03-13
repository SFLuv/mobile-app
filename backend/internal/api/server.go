package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/model"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/service"
)

type Server struct {
	runtime *service.Runtime
	up      websocket.Upgrader
}

func New(runtime *service.Runtime) *Server {
	return &Server{
		runtime: runtime,
		up: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(corsMiddleware)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r.Route("/v1", func(r chi.Router) {
		r.Post("/rpc/{chainId}/{paymasterAddress}", s.handleRPC)
		r.Post("/rpc/{chainId}", s.handleRPC)

		r.Get("/accounts/{chainId}/{account}/exists", s.accountExists)
		r.Get("/activity/{chainId}/{account}", s.activity)

		r.Put("/push/{chainId}/{account}/token", s.putPush)
		r.Delete("/push/{chainId}/{account}/token/{token}", s.deletePush)

		r.Get("/events/{chainId}/{account}", s.eventsWS)
	})

	return r
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleRPC(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	chainID, err := strconv.ParseInt(chi.URLParam(r, "chainId"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, model.NewError(nil, -32602, "invalid chain id"))
		return
	}
	paymasterAddr := chi.URLParam(r, "paymasterAddress")

	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeJSON(w, http.StatusBadRequest, model.NewError(nil, -32700, "invalid json"))
		return
	}

	var single model.JSONRPCRequest
	if err := json.Unmarshal(raw, &single); err == nil && single.Method != "" {
		resp := s.dispatchRPC(ctx, chainID, paymasterAddr, single)
		writeJSON(w, http.StatusOK, resp)
		return
	}

	var batch []model.JSONRPCRequest
	if err := json.Unmarshal(raw, &batch); err != nil {
		writeJSON(w, http.StatusBadRequest, model.NewError(nil, -32700, "invalid rpc payload"))
		return
	}

	responses := make([]model.JSONRPCResponse, 0, len(batch))
	for _, req := range batch {
		responses = append(responses, s.dispatchRPC(ctx, chainID, paymasterAddr, req))
	}
	writeJSON(w, http.StatusOK, responses)
}

func (s *Server) dispatchRPC(ctx context.Context, chainID int64, paymasterAddr string, req model.JSONRPCRequest) model.JSONRPCResponse {
	switch req.Method {
	case "eth_chainId":
		id, err := s.runtime.ChainIDHex(chainID)
		if err != nil {
			return model.NewError(req.ID, -32000, err.Error())
		}
		return model.NewSuccess(req.ID, id)

	case "pm_sponsorUserOperation":
		if paymasterAddr == "" {
			return model.NewError(req.ID, -32602, "paymaster address missing")
		}
		res, err := s.runtime.SponsorUserOperation(ctx, chainID, paymasterAddr, req.Params)
		if err != nil {
			return model.NewError(req.ID, -32000, err.Error())
		}
		return model.NewSuccess(req.ID, res)

	case "pm_ooSponsorUserOperation":
		if paymasterAddr == "" {
			return model.NewError(req.ID, -32602, "paymaster address missing")
		}
		res, err := s.runtime.OOSponsorUserOperation(ctx, chainID, paymasterAddr, req.Params)
		if err != nil {
			return model.NewError(req.ID, -32000, err.Error())
		}
		return model.NewSuccess(req.ID, res)

	case "eth_sendUserOperation":
		if paymasterAddr == "" {
			return model.NewError(req.ID, -32602, "paymaster address missing")
		}
		res, err := s.runtime.SendUserOperation(ctx, chainID, paymasterAddr, req.Params)
		if err != nil {
			return model.NewError(req.ID, -32000, err.Error())
		}
		return model.NewSuccess(req.ID, res)

	case "eth_getTransactionReceipt":
		var params []string
		if err := json.Unmarshal(req.Params, &params); err != nil || len(params) < 1 {
			return model.NewError(req.ID, -32602, "invalid params")
		}
		res, err := s.runtime.GetReceipt(ctx, chainID, params[0])
		if err != nil {
			return model.NewError(req.ID, -32000, err.Error())
		}
		return model.NewSuccess(req.ID, res)

	default:
		return model.NewError(req.ID, -32601, "method not found")
	}
}

func (s *Server) accountExists(w http.ResponseWriter, r *http.Request) {
	chainID, err := strconv.ParseInt(chi.URLParam(r, "chainId"), 10, 64)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	account := chi.URLParam(r, "account")
	ok, err := s.runtime.AccountExists(r.Context(), chainID, common.HexToAddress(account))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	chainID, err := strconv.ParseInt(chi.URLParam(r, "chainId"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid chain id"})
		return
	}
	account := chi.URLParam(r, "account")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	items, err := s.runtime.Activity(r.Context(), chainID, strings.ToLower(account), limit)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type putPushBody struct {
	Platform   string `json:"platform"`
	Token      string `json:"token"`
	AppVersion string `json:"app_version"`
}

func (s *Server) putPush(w http.ResponseWriter, r *http.Request) {
	chainID, err := strconv.ParseInt(chi.URLParam(r, "chainId"), 10, 64)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	account := strings.ToLower(chi.URLParam(r, "account"))

	body := putPushBody{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if body.Token == "" || body.Platform == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	err = s.runtime.UpsertPushDevice(model.PushDevice{
		ChainID:    chainID,
		Account:    account,
		Platform:   body.Platform,
		Token:      body.Token,
		AppVersion: body.AppVersion,
		CreatedAt:  time.Now().UTC(),
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) deletePush(w http.ResponseWriter, r *http.Request) {
	chainID, err := strconv.ParseInt(chi.URLParam(r, "chainId"), 10, 64)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	account := strings.ToLower(chi.URLParam(r, "account"))
	token := chi.URLParam(r, "token")
	if token == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if err := s.runtime.DeletePushDevice(chainID, account, token); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) eventsWS(w http.ResponseWriter, r *http.Request) {
	account := strings.ToLower(chi.URLParam(r, "account"))
	conn, err := s.up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.runtime.Hub().Subscribe(account, conn)
	defer func() {
		s.runtime.Hub().Unsubscribe(account, conn)
		_ = conn.Close()
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
