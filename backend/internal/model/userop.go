package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
)

var (
	FuncSigExecute      = crypto.Keccak256([]byte("execute(address,uint256,bytes)"))[:4]
	FuncSigExecuteBatch = crypto.Keccak256([]byte("executeBatch(address[],uint256[],bytes[])"))[:4]
)

type UserOperation struct {
	Sender               common.Address `json:"sender"`
	Nonce                *big.Int       `json:"nonce"`
	InitCode             []byte         `json:"initCode"`
	CallData             []byte         `json:"callData"`
	CallGasLimit         *big.Int       `json:"callGasLimit"`
	VerificationGasLimit *big.Int       `json:"verificationGasLimit"`
	PreVerificationGas   *big.Int       `json:"preVerificationGas"`
	MaxFeePerGas         *big.Int       `json:"maxFeePerGas"`
	MaxPriorityFeePerGas *big.Int       `json:"maxPriorityFeePerGas"`
	PaymasterAndData     []byte         `json:"paymasterAndData"`
	Signature            []byte         `json:"signature"`
}

type userOpJSON struct {
	Sender               string `json:"sender"`
	Nonce                string `json:"nonce"`
	InitCode             string `json:"initCode"`
	CallData             string `json:"callData"`
	CallGasLimit         string `json:"callGasLimit"`
	VerificationGasLimit string `json:"verificationGasLimit"`
	PreVerificationGas   string `json:"preVerificationGas"`
	MaxFeePerGas         string `json:"maxFeePerGas"`
	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
	PaymasterAndData     string `json:"paymasterAndData"`
	Signature            string `json:"signature"`
}

func (u UserOperation) MarshalJSON() ([]byte, error) {
	return json.Marshal(userOpJSON{
		Sender:               u.Sender.Hex(),
		Nonce:                hexutil.EncodeBig(u.Nonce),
		InitCode:             hexutil.Encode(u.InitCode),
		CallData:             hexutil.Encode(u.CallData),
		CallGasLimit:         hexutil.EncodeBig(u.CallGasLimit),
		VerificationGasLimit: hexutil.EncodeBig(u.VerificationGasLimit),
		PreVerificationGas:   hexutil.EncodeBig(u.PreVerificationGas),
		MaxFeePerGas:         hexutil.EncodeBig(u.MaxFeePerGas),
		MaxPriorityFeePerGas: hexutil.EncodeBig(u.MaxPriorityFeePerGas),
		PaymasterAndData:     hexutil.Encode(u.PaymasterAndData),
		Signature:            hexutil.Encode(u.Signature),
	})
}

func (u *UserOperation) UnmarshalJSON(input []byte) error {
	aux := userOpJSON{}
	if err := json.Unmarshal(input, &aux); err != nil {
		return err
	}

	u.Sender = common.HexToAddress(aux.Sender)
	var err error
	if u.Nonce, err = hexutil.DecodeBig(aux.Nonce); err != nil {
		return fmt.Errorf("nonce: %w", err)
	}
	if u.InitCode, err = hexutil.Decode(aux.InitCode); err != nil {
		return fmt.Errorf("initCode: %w", err)
	}
	if u.CallData, err = hexutil.Decode(aux.CallData); err != nil {
		return fmt.Errorf("callData: %w", err)
	}
	if u.CallGasLimit, err = hexutil.DecodeBig(aux.CallGasLimit); err != nil {
		return fmt.Errorf("callGasLimit: %w", err)
	}
	if u.VerificationGasLimit, err = hexutil.DecodeBig(aux.VerificationGasLimit); err != nil {
		return fmt.Errorf("verificationGasLimit: %w", err)
	}
	if u.PreVerificationGas, err = hexutil.DecodeBig(aux.PreVerificationGas); err != nil {
		return fmt.Errorf("preVerificationGas: %w", err)
	}
	if u.MaxFeePerGas, err = hexutil.DecodeBig(aux.MaxFeePerGas); err != nil {
		return fmt.Errorf("maxFeePerGas: %w", err)
	}
	if u.MaxPriorityFeePerGas, err = hexutil.DecodeBig(aux.MaxPriorityFeePerGas); err != nil {
		return fmt.Errorf("maxPriorityFeePerGas: %w", err)
	}
	if u.PaymasterAndData, err = hexutil.Decode(aux.PaymasterAndData); err != nil {
		return fmt.Errorf("paymasterAndData: %w", err)
	}
	if u.Signature, err = hexutil.Decode(aux.Signature); err != nil {
		return fmt.Errorf("signature: %w", err)
	}

	return nil
}

func (u *UserOperation) ValidateForSponsorship() error {
	return u.ValidateForPaymasterType("cw")
}

func (u *UserOperation) ValidateForPaymasterType(paymasterType string) error {
	if len(u.CallData) < 4 {
		return errors.New("callData is too short")
	}

	selector := u.CallData[:4]
	normalized := strings.ToLower(strings.TrimSpace(paymasterType))

	switch normalized {
	case "", "cw":
		if !equal4(selector, FuncSigExecute) && !equal4(selector, FuncSigExecuteBatch) {
			return errors.New("unsupported callData selector for cw paymaster")
		}
	default:
		return fmt.Errorf("unsupported paymaster type %q: only cw is supported", paymasterType)
	}

	return nil
}

func equal4(a, b []byte) bool {
	if len(a) < 4 || len(b) < 4 {
		return false
	}
	for i := 0; i < 4; i++ {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// EntryPointUserOperation is used for ABI packing with handleOps.
type EntryPointUserOperation struct {
	Sender               common.Address
	Nonce                *big.Int
	InitCode             []byte
	CallData             []byte
	CallGasLimit         *big.Int
	VerificationGasLimit *big.Int
	PreVerificationGas   *big.Int
	MaxFeePerGas         *big.Int
	MaxPriorityFeePerGas *big.Int
	PaymasterAndData     []byte
	Signature            []byte
}

func (u *UserOperation) ToEntryPointTuple() EntryPointUserOperation {
	return EntryPointUserOperation{
		Sender:               u.Sender,
		Nonce:                u.Nonce,
		InitCode:             u.InitCode,
		CallData:             u.CallData,
		CallGasLimit:         u.CallGasLimit,
		VerificationGasLimit: u.VerificationGasLimit,
		PreVerificationGas:   u.PreVerificationGas,
		MaxFeePerGas:         u.MaxFeePerGas,
		MaxPriorityFeePerGas: u.MaxPriorityFeePerGas,
		PaymasterAndData:     u.PaymasterAndData,
		Signature:            u.Signature,
	}
}

func (u *UserOperation) GetUserOpHash(entryPoint common.Address, chainID *big.Int) common.Hash {
	packed := packUserOp(u)
	innerHash := crypto.Keccak256Hash(packed)

	bytes32Ty, _ := abi.NewType("bytes32", "bytes32", nil)
	addressTy, _ := abi.NewType("address", "address", nil)
	uint256Ty, _ := abi.NewType("uint256", "uint256", nil)

	args := abi.Arguments{
		{Type: bytes32Ty},
		{Type: addressTy},
		{Type: uint256Ty},
	}

	outer, _ := args.Pack(innerHash, entryPoint, chainID)
	return crypto.Keccak256Hash(outer)
}

func packUserOp(op *UserOperation) []byte {
	addressTy, _ := abi.NewType("address", "address", nil)
	uint256Ty, _ := abi.NewType("uint256", "uint256", nil)
	bytes32Ty, _ := abi.NewType("bytes32", "bytes32", nil)

	args := abi.Arguments{
		{Type: addressTy},
		{Type: uint256Ty},
		{Type: bytes32Ty},
		{Type: bytes32Ty},
		{Type: uint256Ty},
		{Type: uint256Ty},
		{Type: uint256Ty},
		{Type: uint256Ty},
		{Type: uint256Ty},
		{Type: bytes32Ty},
	}

	packed, _ := args.Pack(
		op.Sender,
		op.Nonce,
		crypto.Keccak256Hash(op.InitCode),
		crypto.Keccak256Hash(op.CallData),
		op.CallGasLimit,
		op.VerificationGasLimit,
		op.PreVerificationGas,
		op.MaxFeePerGas,
		op.MaxPriorityFeePerGas,
		crypto.Keccak256Hash(op.PaymasterAndData),
	)

	return packed
}
