package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/sfluv/sfluv-wallet-platform/backend/internal/api"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/config"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/events"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/service"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/store"
)

func main() {
	configPath := flag.String("config", "./chains.json", "path to chains config")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config load error: %v", err)
	}

	st, err := store.NewSQLiteStore(cfg.DBPath)
	if err != nil {
		log.Fatalf("store init error: %v", err)
	}
	defer st.Close()

	hub := events.NewHub()
	runtime, err := service.NewRuntime(cfg, st, hub)
	if err != nil {
		log.Fatalf("runtime init error: %v", err)
	}
	defer runtime.Close()

	srv := api.New(runtime)
	log.Printf("sfluv backend listening on %s", cfg.ListenAddr)
	if err := http.ListenAndServe(cfg.ListenAddr, srv.Router()); err != nil {
		log.Fatal(err)
	}
}
