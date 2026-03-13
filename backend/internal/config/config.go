package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	ListenAddr string          `json:"listen_addr"`
	DBPath     string          `json:"db_path"`
	Chains     map[int64]Chain `json:"chains"`
}

type Chain struct {
	ChainID        int64                `json:"chain_id"`
	RPCURL         string               `json:"rpc_url"`
	RPCWSURL       string               `json:"rpc_ws_url"`
	EntryPoint     string               `json:"entrypoint_address"`
	AccountFactory string               `json:"account_factory_address"`
	Paymasters     map[string]Paymaster `json:"paymasters"`
	Token          TokenConfig          `json:"token"`
}

type Paymaster struct {
	Address           string `json:"address"`
	EntryPoint        string `json:"entrypoint_address"`
	Type              string `json:"type"`
	SponsorPrivateKey string `json:"sponsor_private_key"`
}

type TokenConfig struct {
	Address  string `json:"address"`
	Symbol   string `json:"symbol"`
	Decimals int    `json:"decimals"`
}

func Load(path string) (*Config, error) {
	if path == "" {
		path = "./chains.json"
	}

	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg := &Config{}
	if err := json.Unmarshal(b, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.ListenAddr == "" {
		cfg.ListenAddr = ":8088"
	}
	if cfg.DBPath == "" {
		cfg.DBPath = "./data/sfluv.db"
	}
	if len(cfg.Chains) == 0 {
		return nil, errors.New("no chains configured")
	}

	// Allow secret override from env so keys don't need to live in the file.
	for chainID, chain := range cfg.Chains {
		if v := os.Getenv(fmt.Sprintf("CHAIN_RPC_URL_%d", chainID)); v != "" {
			chain.RPCURL = v
		}
		if v := os.Getenv(fmt.Sprintf("ENTRYPOINT_ADDRESS_%d", chainID)); v != "" {
			chain.EntryPoint = v
		}
		if v := os.Getenv(fmt.Sprintf("ACCOUNT_FACTORY_ADDRESS_%d", chainID)); v != "" {
			chain.AccountFactory = v
		}

		if chain.EntryPoint == "" {
			return nil, fmt.Errorf("missing entrypoint address for chain %d", chainID)
		}

		normalizedPaymasters := make(map[string]Paymaster, len(chain.Paymasters))
		for addr, pm := range chain.Paymasters {
			normalizedAddr := strings.ToLower(pm.Address)
			if normalizedAddr == "" {
				normalizedAddr = strings.ToLower(addr)
			}
			pm.Address = normalizedAddr

			envKey := fmt.Sprintf("SPONSOR_PRIVATE_KEY_%d_%s", chainID, strings.ToUpper(strings.TrimPrefix(normalizedAddr, "0x")))
			if v := os.Getenv(envKey); v != "" {
				pm.SponsorPrivateKey = v
			}
			if pm.SponsorPrivateKey == "" {
				if v := os.Getenv(fmt.Sprintf("SPONSOR_PRIVATE_KEY_%d", chainID)); v != "" {
					pm.SponsorPrivateKey = v
				}
			}

			if pm.EntryPoint == "" {
				pm.EntryPoint = chain.EntryPoint
			}
			pm.EntryPoint = strings.ToLower(pm.EntryPoint)
			if pm.EntryPoint == "" {
				return nil, fmt.Errorf("missing paymaster entrypoint for %s on chain %d", normalizedAddr, chainID)
			}

			pm.Type = strings.ToLower(strings.TrimSpace(pm.Type))
			if pm.Type == "" {
				pm.Type = "cw"
			}
			if pm.Type != "cw" {
				return nil, fmt.Errorf("unsupported paymaster type %q for %s on chain %d: only cw is supported", pm.Type, normalizedAddr, chainID)
			}

			normalizedPaymasters[normalizedAddr] = pm
		}
		chain.Paymasters = normalizedPaymasters
		cfg.Chains[chainID] = chain
	}

	return cfg, nil
}
