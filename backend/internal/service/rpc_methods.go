package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	ethtypes "github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/sfluv/sfluv-wallet-platform/backend/internal/model"
)

const (
	paymasterSigValiditySeconds   = int64(300)
	paymasterOOSigValiditySeconds = int64(7 * 24 * 3600)
)

var (
	paymasterABI = mustABI(`[{
		"inputs":[
			{"components":[
				{"internalType":"address","name":"sender","type":"address"},
				{"internalType":"uint256","name":"nonce","type":"uint256"},
				{"internalType":"bytes","name":"initCode","type":"bytes"},
				{"internalType":"bytes","name":"callData","type":"bytes"},
				{"internalType":"uint256","name":"callGasLimit","type":"uint256"},
				{"internalType":"uint256","name":"verificationGasLimit","type":"uint256"},
				{"internalType":"uint256","name":"preVerificationGas","type":"uint256"},
				{"internalType":"uint256","name":"maxFeePerGas","type":"uint256"},
				{"internalType":"uint256","name":"maxPriorityFeePerGas","type":"uint256"},
				{"internalType":"bytes","name":"paymasterAndData","type":"bytes"},
				{"internalType":"bytes","name":"signature","type":"bytes"}
			],"internalType":"struct UserOperation","name":"userOp","type":"tuple"},
			{"internalType":"uint48","name":"validUntil","type":"uint48"},
			{"internalType":"uint48","name":"validAfter","type":"uint48"}
		],
		"name":"getHash",
		"outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],
		"stateMutability":"view",
		"type":"function"
	}]`)

	entryPointABI = mustABI(`[{
		"inputs":[
			{"components":[
				{"internalType":"address","name":"sender","type":"address"},
				{"internalType":"uint256","name":"nonce","type":"uint256"},
				{"internalType":"bytes","name":"initCode","type":"bytes"},
				{"internalType":"bytes","name":"callData","type":"bytes"},
				{"internalType":"uint256","name":"callGasLimit","type":"uint256"},
				{"internalType":"uint256","name":"verificationGasLimit","type":"uint256"},
				{"internalType":"uint256","name":"preVerificationGas","type":"uint256"},
				{"internalType":"uint256","name":"maxFeePerGas","type":"uint256"},
				{"internalType":"uint256","name":"maxPriorityFeePerGas","type":"uint256"},
				{"internalType":"bytes","name":"paymasterAndData","type":"bytes"},
				{"internalType":"bytes","name":"signature","type":"bytes"}
			],"internalType":"struct UserOperation[]","name":"ops","type":"tuple[]"},
			{"internalType":"address","name":"beneficiary","type":"address"}
		],
		"name":"handleOps",
		"outputs":[],
		"stateMutability":"nonpayable",
		"type":"function"
	}]`)
)

func mustABI(raw string) abi.ABI {
	a, err := abi.JSON(strings.NewReader(raw))
	if err != nil {
		panic(err)
	}
	return a
}

func parseParams(raw json.RawMessage) ([]any, error) {
	var params []any
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, err
	}
	return params, nil
}

func parseUserOpFromAny(v any) (*model.UserOperation, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	op := &model.UserOperation{}
	if err := json.Unmarshal(b, op); err != nil {
		return nil, err
	}
	return op, nil
}

func validateEntryPointParam(params []any, expected common.Address) error {
	if len(params) < 2 {
		return errors.New("invalid params")
	}
	entrypoint, ok := params[1].(string)
	if !ok || !strings.EqualFold(entrypoint, expected.Hex()) {
		return errors.New("entrypoint mismatch")
	}
	return nil
}

func resolveSponsor(chain *ChainRuntime, paymasterAddress string) (Sponsor, common.Address, error) {
	sponsor, ok := chain.Sponsors[strings.ToLower(paymasterAddress)]
	if !ok {
		return Sponsor{}, common.Address{}, errors.New("unknown paymaster")
	}
	paymaster := common.HexToAddress(paymasterAddress)
	return sponsor, paymaster, nil
}

func validatePaymasterTypeParam(params []any, expectedType string) error {
	if len(params) < 3 {
		return nil
	}

	payload, ok := params[2].(map[string]any)
	if !ok {
		return errors.New("invalid paymaster type payload")
	}

	rawType, _ := payload["type"].(string)
	normalized := strings.ToLower(strings.TrimSpace(rawType))
	if normalized == "" {
		return nil
	}
	if normalized != strings.ToLower(expectedType) {
		return errors.New("paymaster type mismatch")
	}
	return nil
}

func (r *Runtime) SponsorUserOperation(ctx context.Context, chainID int64, paymasterAddress string, rawParams json.RawMessage) (any, error) {
	chain, err := r.Chain(chainID)
	if err != nil {
		return nil, err
	}

	params, err := parseParams(rawParams)
	if err != nil {
		return nil, err
	}
	op, err := parseUserOpFromAny(params[0])
	if err != nil {
		return nil, fmt.Errorf("parse userop: %w", err)
	}

	sponsor, paymaster, err := resolveSponsor(chain, paymasterAddress)
	if err != nil {
		return nil, err
	}
	if err := validateEntryPointParam(params, sponsor.EntryPoint); err != nil {
		return nil, err
	}
	if err := op.ValidateForPaymasterType(sponsor.Type); err != nil {
		return nil, err
	}
	if err := validatePaymasterTypeParam(params, sponsor.Type); err != nil {
		return nil, err
	}

	now := time.Now().Unix()
	validUntil := big.NewInt(now + paymasterSigValiditySeconds)
	validAfter := big.NewInt(now - 10)

	paymasterData, err := r.buildPaymasterData(ctx, chain, paymaster, sponsor, op, validUntil, validAfter)
	if err != nil {
		return nil, err
	}

	return paymasterData, nil
}

func (r *Runtime) OOSponsorUserOperation(ctx context.Context, chainID int64, paymasterAddress string, rawParams json.RawMessage) (any, error) {
	chain, err := r.Chain(chainID)
	if err != nil {
		return nil, err
	}

	params, err := parseParams(rawParams)
	if err != nil {
		return nil, err
	}
	op, err := parseUserOpFromAny(params[0])
	if err != nil {
		return nil, fmt.Errorf("parse userop: %w", err)
	}

	count := 1
	if len(params) >= 4 {
		switch v := params[3].(type) {
		case float64:
			count = int(v)
		case string:
			if iv, e := strconv.Atoi(v); e == nil {
				count = iv
			}
		}
	}
	if count < 1 {
		count = 1
	}
	if count > 20 {
		count = 20
	}

	sponsor, paymaster, err := resolveSponsor(chain, paymasterAddress)
	if err != nil {
		return nil, err
	}
	if err := validateEntryPointParam(params, sponsor.EntryPoint); err != nil {
		return nil, err
	}
	if err := op.ValidateForPaymasterType(sponsor.Type); err != nil {
		return nil, err
	}
	if err := validatePaymasterTypeParam(params, sponsor.Type); err != nil {
		return nil, err
	}

	now := time.Now().Unix()
	validUntil := big.NewInt(now + paymasterOOSigValiditySeconds)
	validAfter := big.NewInt(now - 10)

	results := make([]any, 0, count)
	for i := 0; i < count; i++ {
		candidate := *op
		candidate.Nonce = big.NewInt(time.Now().UnixNano() + int64(i))
		paymasterData, err := r.buildPaymasterData(ctx, chain, paymaster, sponsor, &candidate, validUntil, validAfter)
		if err != nil {
			return nil, err
		}
		paymasterData["nonce"] = hexutil.EncodeBig(candidate.Nonce)
		results = append(results, paymasterData)
	}

	return results, nil
}

func (r *Runtime) buildPaymasterData(ctx context.Context, chain *ChainRuntime, paymaster common.Address, sponsor Sponsor, op *model.UserOperation, validUntil, validAfter *big.Int) (map[string]any, error) {
	hash, err := r.getPaymasterHash(ctx, chain, paymaster, op, validUntil, validAfter)
	if err != nil {
		return nil, err
	}

	sig, err := crypto.Sign(accounts.TextHash(hash[:]), sponsor.PrivateKey)
	if err != nil {
		return nil, err
	}
	if sig[crypto.RecoveryIDOffset] == 0 || sig[crypto.RecoveryIDOffset] == 1 {
		sig[crypto.RecoveryIDOffset] += 27
	}

	uint48Ty, _ := abi.NewType("uint48", "uint48", nil)
	args := abi.Arguments{{Type: uint48Ty}, {Type: uint48Ty}}
	validity, err := args.Pack(validUntil, validAfter)
	if err != nil {
		return nil, err
	}

	pad := append(paymaster.Bytes(), validity...)
	pad = append(pad, sig...)

	return map[string]any{
		"paymasterAndData":     hexutil.Encode(pad),
		"preVerificationGas":   hexutil.EncodeBig(op.PreVerificationGas),
		"verificationGasLimit": hexutil.EncodeBig(op.VerificationGasLimit),
		"callGasLimit":         hexutil.EncodeBig(op.CallGasLimit),
	}, nil
}

func (r *Runtime) getPaymasterHash(ctx context.Context, chain *ChainRuntime, paymaster common.Address, op *model.UserOperation, validUntil, validAfter *big.Int) ([32]byte, error) {
	var outHash [32]byte

	input, err := paymasterABI.Pack("getHash", op.ToEntryPointTuple(), validUntil, validAfter)
	if err != nil {
		return outHash, err
	}

	out, err := chain.Client.CallContract(ctx, ethereum.CallMsg{To: &paymaster, Data: input}, nil)
	if err != nil {
		return outHash, err
	}

	vals, err := paymasterABI.Unpack("getHash", out)
	if err != nil {
		return outHash, err
	}
	if len(vals) != 1 {
		return outHash, errors.New("unexpected getHash output")
	}
	h, ok := vals[0].([32]byte)
	if !ok {
		return outHash, errors.New("invalid getHash type")
	}
	return h, nil
}

func (r *Runtime) SendUserOperation(ctx context.Context, chainID int64, paymasterAddress string, rawParams json.RawMessage) (any, error) {
	chain, err := r.Chain(chainID)
	if err != nil {
		return nil, err
	}

	params, err := parseParams(rawParams)
	if err != nil {
		return nil, err
	}
	if len(params) < 2 {
		return nil, errors.New("invalid params")
	}

	op, err := parseUserOpFromAny(params[0])
	if err != nil {
		return nil, fmt.Errorf("parse userop: %w", err)
	}

	sponsor, paymaster, err := resolveSponsor(chain, paymasterAddress)
	if err != nil {
		return nil, err
	}
	if err := validateEntryPointParam(params, sponsor.EntryPoint); err != nil {
		return nil, err
	}
	if err := op.ValidateForPaymasterType(sponsor.Type); err != nil {
		return nil, err
	}
	if err := r.verifyPaymasterSignature(ctx, chain, paymaster, sponsor, op); err != nil {
		return nil, err
	}

	hash := op.GetUserOpHash(sponsor.EntryPoint, big.NewInt(chain.ChainID)).Hex()
	raw, _ := json.Marshal(op)
	if err := r.store.AddUserOp(model.StoredUserOp{
		UserOpHash: hash,
		ChainID:    chainID,
		Sender:     strings.ToLower(op.Sender.Hex()),
		Status:     model.UserOpPending,
		RawUserOp:  raw,
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}); err != nil {
		return nil, err
	}

	txHash, err := r.submitHandleOps(ctx, chain, sponsor, op)
	if err != nil {
		_ = r.store.UpdateUserOpStatus(hash, model.UserOpReverted)
		r.publishStatus(op.Sender.Hex(), hash, nil, model.UserOpReverted)
		return nil, err
	}

	if err := r.store.UpdateUserOpSubmitted(hash, txHash); err != nil {
		return nil, err
	}
	r.publishStatus(op.Sender.Hex(), hash, &txHash, model.UserOpSubmitted)

	go r.waitForReceipt(chain, op.Sender.Hex(), hash, txHash)

	return hash, nil
}

func (r *Runtime) verifyPaymasterSignature(ctx context.Context, chain *ChainRuntime, paymaster common.Address, sponsor Sponsor, op *model.UserOperation) error {
	if len(op.PaymasterAndData) < 84+65 {
		return errors.New("invalid paymasterAndData length")
	}
	if !bytes.Equal(op.PaymasterAndData[:20], paymaster.Bytes()) {
		return errors.New("paymaster address mismatch")
	}

	uint48Ty, _ := abi.NewType("uint48", "uint48", nil)
	args := abi.Arguments{{Type: uint48Ty}, {Type: uint48Ty}}
	validity, err := args.Unpack(op.PaymasterAndData[20:84])
	if err != nil {
		return err
	}

	validUntil := validity[0].(*big.Int)
	validAfter := validity[1].(*big.Int)
	now := time.Now().Unix()
	if validUntil.Int64() < now {
		return errors.New("paymaster signature expired")
	}
	if validAfter.Int64() > now {
		return errors.New("paymaster signature not active")
	}

	h, err := r.getPaymasterHash(ctx, chain, paymaster, op, validUntil, validAfter)
	if err != nil {
		return err
	}
	msgHash := accounts.TextHash(h[:])

	sig := append([]byte{}, op.PaymasterAndData[84:]...)
	if sig[crypto.RecoveryIDOffset] >= 27 {
		sig[crypto.RecoveryIDOffset] -= 27
	}
	pub, err := crypto.SigToPub(msgHash, sig)
	if err != nil {
		return errors.New("invalid paymaster signature")
	}
	recovered := crypto.PubkeyToAddress(*pub)
	if recovered != sponsor.Address {
		return errors.New("paymaster signature not signed by sponsor")
	}
	return nil
}

func (r *Runtime) submitHandleOps(ctx context.Context, chain *ChainRuntime, sponsor Sponsor, op *model.UserOperation) (string, error) {
	data, err := entryPointABI.Pack("handleOps", []model.EntryPointUserOperation{op.ToEntryPointTuple()}, sponsor.Address)
	if err != nil {
		return "", err
	}

	nonce, err := chain.Client.PendingNonceAt(ctx, sponsor.Address)
	if err != nil {
		return "", err
	}

	tipCap, err := chain.Client.SuggestGasTipCap(ctx)
	if err != nil {
		return "", err
	}
	head, err := chain.Client.HeaderByNumber(ctx, nil)
	if err != nil {
		return "", err
	}
	if head.BaseFee == nil {
		head.BaseFee = big.NewInt(0)
	}
	feeCap := new(big.Int).Add(new(big.Int).Mul(head.BaseFee, big.NewInt(2)), tipCap)

	gasLimit, err := chain.Client.EstimateGas(ctx, ethereum.CallMsg{
		From: sponsor.Address,
		To:   &sponsor.EntryPoint,
		Data: data,
	})
	if err != nil {
		gasLimit = uint64(700_000)
	}

	tx := ethtypes.NewTx(&ethtypes.DynamicFeeTx{
		ChainID:   big.NewInt(chain.ChainID),
		Nonce:     nonce,
		GasTipCap: tipCap,
		GasFeeCap: feeCap,
		Gas:       gasLimit,
		To:        &sponsor.EntryPoint,
		Value:     big.NewInt(0),
		Data:      data,
	})

	signed, err := ethtypes.SignTx(tx, ethtypes.NewLondonSigner(big.NewInt(chain.ChainID)), sponsor.PrivateKey)
	if err != nil {
		return "", err
	}
	if err := chain.Client.SendTransaction(ctx, signed); err != nil {
		return "", err
	}

	return signed.Hash().Hex(), nil
}

func (r *Runtime) waitForReceipt(chain *ChainRuntime, sender, userOpHash, txHash string) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	txh := common.HexToHash(txHash)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = r.store.UpdateUserOpStatus(userOpHash, model.UserOpTimeout)
			r.publishStatus(sender, userOpHash, &txHash, model.UserOpTimeout)
			return
		case <-ticker.C:
			receipt, err := chain.Client.TransactionReceipt(ctx, txh)
			if err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "not found") {
					continue
				}
				_ = r.store.UpdateUserOpStatus(userOpHash, model.UserOpTimeout)
				r.publishStatus(sender, userOpHash, &txHash, model.UserOpTimeout)
				return
			}

			if receipt.Status == ethtypes.ReceiptStatusSuccessful {
				_ = r.store.UpdateUserOpStatus(userOpHash, model.UserOpSuccess)
				r.publishStatus(sender, userOpHash, &txHash, model.UserOpSuccess)
				return
			}

			_ = r.store.UpdateUserOpStatus(userOpHash, model.UserOpReverted)
			r.publishStatus(sender, userOpHash, &txHash, model.UserOpReverted)
			return
		}
	}
}

func (r *Runtime) publishStatus(account, userOpHash string, txHash *string, status model.UserOpStatus) {
	r.hub.Broadcast(account, map[string]any{
		"type":         "userop.status",
		"user_op_hash": userOpHash,
		"tx_hash":      txHash,
		"status":       status,
		"timestamp":    time.Now().UTC(),
	})
}

func (r *Runtime) GetReceipt(ctx context.Context, chainID int64, hash string) (any, error) {
	chain, err := r.Chain(chainID)
	if err != nil {
		return nil, err
	}

	if op, err := r.store.GetUserOp(hash); err == nil && op != nil {
		if op.TxHash == nil || *op.TxHash == "" {
			return nil, nil
		}
		hash = *op.TxHash
	}

	receipt, err := chain.Client.TransactionReceipt(ctx, common.HexToHash(hash))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil, nil
		}
		return nil, err
	}
	return receipt, nil
}

func (r *Runtime) Activity(ctx context.Context, chainID int64, account string, limit int) ([]model.ActivityItem, error) {
	if _, err := r.Chain(chainID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return r.store.ListActivityByAccount(chainID, strings.ToLower(account), limit)
}

func (r *Runtime) UpsertPushDevice(device model.PushDevice) error {
	return r.store.UpsertPushDevice(device)
}

func (r *Runtime) DeletePushDevice(chainID int64, account, token string) error {
	return r.store.DeletePushDevice(chainID, strings.ToLower(account), token)
}
