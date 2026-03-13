package service

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/config"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/events"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/store"
)

type Sponsor struct {
	Address    common.Address
	EntryPoint common.Address
	PrivateKey *ecdsa.PrivateKey
	Type       string
}

type ChainRuntime struct {
	ChainID    int64
	EntryPoint common.Address
	Client     *ethclient.Client
	Sponsors   map[string]Sponsor // paymaster address -> sponsor info
}

type Runtime struct {
	chains map[int64]*ChainRuntime
	store  *store.SQLiteStore
	hub    *events.Hub
}

func NewRuntime(cfg *config.Config, st *store.SQLiteStore, hub *events.Hub) (*Runtime, error) {
	r := &Runtime{
		chains: map[int64]*ChainRuntime{},
		store:  st,
		hub:    hub,
	}

	for chainID, chain := range cfg.Chains {
		client, err := ethclient.Dial(chain.RPCURL)
		if err != nil {
			return nil, fmt.Errorf("dial chain %d: %w", chainID, err)
		}

		rt := &ChainRuntime{
			ChainID:    chainID,
			EntryPoint: common.HexToAddress(chain.EntryPoint),
			Client:     client,
			Sponsors:   map[string]Sponsor{},
		}

		for paymasterAddr, pm := range chain.Paymasters {
			addrHex := strings.ToLower(pm.Address)
			if addrHex == "" {
				addrHex = strings.ToLower(paymasterAddr)
			}

			if pm.SponsorPrivateKey == "" {
				return nil, fmt.Errorf("missing sponsor key for paymaster %s on chain %d", addrHex, chainID)
			}

			key := strings.TrimPrefix(pm.SponsorPrivateKey, "0x")
			pk, err := crypto.HexToECDSA(key)
			if err != nil {
				return nil, fmt.Errorf("invalid sponsor key for %s: %w", addrHex, err)
			}
			addr := crypto.PubkeyToAddress(pk.PublicKey)
			rt.Sponsors[addrHex] = Sponsor{
				Address:    addr,
				EntryPoint: common.HexToAddress(pm.EntryPoint),
				PrivateKey: pk,
				Type:       pm.Type,
			}
		}

		r.chains[chainID] = rt
	}

	return r, nil
}

func (r *Runtime) Close() {
	for _, c := range r.chains {
		c.Client.Close()
	}
}

func (r *Runtime) Chain(chainID int64) (*ChainRuntime, error) {
	c, ok := r.chains[chainID]
	if !ok {
		return nil, fmt.Errorf("unsupported chain id %d", chainID)
	}
	return c, nil
}

func (r *Runtime) ChainIDHex(chainID int64) (string, error) {
	if _, err := r.Chain(chainID); err != nil {
		return "", err
	}
	return fmt.Sprintf("0x%x", chainID), nil
}

func (r *Runtime) AccountExists(ctx context.Context, chainID int64, addr common.Address) (bool, error) {
	chain, err := r.Chain(chainID)
	if err != nil {
		return false, err
	}
	code, err := chain.Client.CodeAt(ctx, addr, nil)
	if err != nil {
		return false, err
	}
	return len(code) > 0, nil
}

func toBigInt(v int64) *big.Int {
	return big.NewInt(v)
}
