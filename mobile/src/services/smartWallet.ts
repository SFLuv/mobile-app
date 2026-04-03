import { ethers } from "ethers";
import { BackendClient } from "../api/client";
import { mobileConfig, WalletConfig } from "../config";
import { AppTransaction } from "../types/app";

export type UserOpRPC = {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  signature: string;
};

type SponsorResponse = {
  paymasterAndData: string;
  preVerificationGas?: string;
  verificationGasLimit?: string;
  callGasLimit?: string;
  nonce?: string;
};

export type SendResult = {
  userOpHash: string;
  txHash?: string;
};

export type AmountUnit = "wei" | "token";

export type RouteCandidate = {
  key: string;
  smartIndex: number;
  accountAddress: string;
  deployed: boolean;
  tokenBalanceRaw: ethers.BigNumber;
  tokenBalance: string;
};

export type RouteDiscovery = {
  ownerAddress: string;
  selectedCandidateKey: string;
  candidates: RouteCandidate[];
};

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const ACCOUNT_ABI = [
  "function execute(address dest, uint256 value, bytes func)",
];

const SAFE_ACCOUNT_ABI = [
  "function execTransactionFromModule(address to, uint256 value, bytes data, uint8 operation) returns (bool success)",
];

const ACCOUNT_FACTORY_ABI = [
  "function getAddress(address owner, uint256 salt) view returns (address)",
  "function createAccount(address owner, uint256 salt) returns (address)",
];

const TOKEN_ENTRYPOINT_ABI = [
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
];

const NONCE_KEY_ZERO = 0;
const MAX_TRANSFER_LOG_WINDOWS = 24;
const TRANSFER_LOG_WINDOW = 9_500;
const DISCOVERY_BATCH_SIZE = 2;
const PROVIDER_POLLING_INTERVAL_MS = 2000;
const SMART_WALLET_DEPLOYMENT_TIMEOUT_MS = 90_000;
const SMART_WALLET_DEPLOYMENT_POLL_INTERVAL_MS = 1_500;
const routeDiscoveryCache = new Map<string, RouteDiscovery>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toHex(value: ethers.BigNumberish): string {
  return normalizeHexQuantity(ethers.BigNumber.from(value).toHexString());
}

function normalizeHexQuantity(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    throw new Error("Expected hex quantity");
  }

  const stripped = trimmed.slice(2).replace(/^0+/, "");
  return stripped ? `0x${stripped}` : "0x0";
}

function candidateKey(smartIndex: number): string {
  return `wallet:${smartIndex}`;
}

function formatTokenAmount(raw: string): string {
  try {
    const formatted = ethers.utils.formatUnits(raw, mobileConfig.tokenDecimals);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmed = fraction.replace(/0+$/, "");
    if (!trimmed) {
      return whole;
    }
    return `${whole}.${trimmed.slice(0, 4)}`;
  } catch {
    return "0";
  }
}

function resolveSelectedCandidate(candidates: RouteCandidate[]): string {
  if (candidates.length === 0) {
    return candidateKey(0);
  }

  const primaryCandidate = candidates.find((candidate) => candidate.smartIndex === 0);
  if (primaryCandidate && (primaryCandidate.deployed || primaryCandidate.tokenBalanceRaw.gt(0))) {
    return primaryCandidate.key;
  }

  const fundedOrDeployed = candidates.find((candidate) => candidate.deployed || candidate.tokenBalanceRaw.gt(0));
  if (fundedOrDeployed) {
    return fundedOrDeployed.key;
  }

  if (primaryCandidate) {
    return primaryCandidate.key;
  }

  return candidates[0].key;
}

function routeDiscoveryCacheKey(ownerAddress: string): string {
  return ownerAddress.trim().toLowerCase();
}

function storeRouteDiscovery(discovery: RouteDiscovery): RouteDiscovery {
  routeDiscoveryCache.set(routeDiscoveryCacheKey(discovery.ownerAddress), discovery);
  return discovery;
}

export function getCachedRouteDiscovery(ownerAddress: string): RouteDiscovery | undefined {
  return routeDiscoveryCache.get(routeDiscoveryCacheKey(ownerAddress));
}

export function clearCachedRouteDiscovery(ownerAddress?: string): void {
  if (!ownerAddress) {
    routeDiscoveryCache.clear();
    return;
  }
  routeDiscoveryCache.delete(routeDiscoveryCacheKey(ownerAddress));
}

async function collectRouteCandidate(
  ownerAddress: string,
  smartIndex: number,
  provider: ethers.providers.JsonRpcProvider,
  token: ethers.Contract,
  factory: ethers.Contract,
): Promise<RouteCandidate | null> {
  const accountAddress = ethers.utils.getAddress(await factory.getAddress(ownerAddress, smartIndex));
  const [code, tokenBalanceRaw] = await Promise.all([
    provider.getCode(accountAddress),
    token.balanceOf(accountAddress) as Promise<ethers.BigNumber>,
  ]);
  const deployed = code !== "0x";

  if (smartIndex !== 0 && !deployed && tokenBalanceRaw.lte(0)) {
    return null;
  }

  return {
    key: candidateKey(smartIndex),
    smartIndex,
    accountAddress,
    deployed,
    tokenBalanceRaw,
    tokenBalance: ethers.utils.formatUnits(tokenBalanceRaw, mobileConfig.tokenDecimals),
  };
}

export async function discoverRoutesForOwner(
  ownerAddress: string,
  provider: ethers.providers.JsonRpcProvider,
  options?: { forceRefresh?: boolean },
): Promise<RouteDiscovery> {
  const cached = options?.forceRefresh ? undefined : getCachedRouteDiscovery(ownerAddress);
  if (cached) {
    return cached;
  }

  const token = new ethers.Contract(mobileConfig.tokenAddress, ERC20_ABI, provider);
  const factory = new ethers.Contract(mobileConfig.wallet.accountFactory, ACCOUNT_FACTORY_ABI, provider);
  const candidates: RouteCandidate[] = [];

  for (let smartIndex = 0; smartIndex < mobileConfig.maxSmartAccountScan; smartIndex += DISCOVERY_BATCH_SIZE) {
    const batch = Array.from(
      { length: Math.min(DISCOVERY_BATCH_SIZE, mobileConfig.maxSmartAccountScan - smartIndex) },
      (_, offset) => smartIndex + offset,
    );
    const batchResults = await Promise.all(
      batch.map((index) => collectRouteCandidate(ownerAddress, index, provider, token, factory)),
    );
    for (const candidate of batchResults) {
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  const selectedCandidateKey = resolveSelectedCandidate(candidates);
  return storeRouteDiscovery({ ownerAddress, selectedCandidateKey, candidates });
}

export class SmartWalletService {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly backend: BackendClient;
  private readonly erc20: ethers.utils.Interface;
  private readonly token: ethers.Contract;
  private readonly account: ethers.utils.Interface;
  private readonly safeAccount: ethers.utils.Interface;
  private readonly accountFactory: ethers.Contract;
  private readonly tokenEntryPoint: ethers.Contract;
  private smartAccountAddressCache?: string;

  constructor(
    private readonly ownerSigner: ethers.Signer,
    private readonly owner: string,
    private readonly walletConfig: WalletConfig,
    private readonly smartIndex: number,
    private readonly getAccessToken?: () => Promise<string | null>,
    smartAccountAddress?: string,
  ) {
    this.provider = new ethers.providers.JsonRpcProvider(mobileConfig.rpcURL, {
      chainId: mobileConfig.chainId,
      name: "berachain",
    });
    this.provider.pollingInterval = PROVIDER_POLLING_INTERVAL_MS;
    this.backend = new BackendClient(
      walletConfig.backendURL,
      mobileConfig.chainId,
      walletConfig.paymasterAddress,
      walletConfig.paymasterType,
      walletConfig.backendKind,
      getAccessToken,
    );

    this.erc20 = new ethers.utils.Interface(ERC20_ABI);
    this.token = new ethers.Contract(mobileConfig.tokenAddress, ERC20_ABI, this.provider);
    this.account = new ethers.utils.Interface(ACCOUNT_ABI);
    this.safeAccount = new ethers.utils.Interface(SAFE_ACCOUNT_ABI);
    this.accountFactory = new ethers.Contract(walletConfig.accountFactory, ACCOUNT_FACTORY_ABI, this.provider);
    this.tokenEntryPoint = new ethers.Contract(walletConfig.entryPoint, TOKEN_ENTRYPOINT_ABI, this.provider);
    this.smartAccountAddressCache = smartAccountAddress ? ethers.utils.getAddress(smartAccountAddress) : undefined;
  }

  ownerAddress(): string {
    return this.owner;
  }

  routeConfig(): WalletConfig {
    return this.walletConfig;
  }

  smartAccountIndex(): number {
    return this.smartIndex;
  }

  async smartAccountAddress(): Promise<string> {
    if (this.smartAccountAddressCache) {
      return this.smartAccountAddressCache;
    }

    const address = await this.accountFactory.getAddress(this.owner, this.smartIndex);
    this.smartAccountAddressCache = ethers.utils.getAddress(address);
    return this.smartAccountAddressCache;
  }

  async smartAccountBalance(): Promise<string> {
    const account = await this.smartAccountAddress();
    const balance: ethers.BigNumber = await this.token.balanceOf(account);
    return ethers.utils.formatUnits(balance, mobileConfig.tokenDecimals);
  }

  async smartAccountBalanceRaw(): Promise<string> {
    const account = await this.smartAccountAddress();
    const balance: ethers.BigNumber = await this.token.balanceOf(account);
    return balance.toString();
  }

  private encodeAccountExecuteCallData(target: string, targetCallData: string): string {
    return this.walletConfig.paymasterType === "cw-safe"
      ? this.safeAccount.encodeFunctionData("execTransactionFromModule", [
          target,
          0,
          targetCallData,
          0, // operation = call
        ])
      : this.account.encodeFunctionData("execute", [
          target,
          0,
          targetCallData,
        ]);
  }

  private async hasDeployedCode(address: string): Promise<boolean> {
    const code = await this.provider.getCode(address);
    return code !== "0x";
  }

  private async waitForDeployedCode(address: string): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < SMART_WALLET_DEPLOYMENT_TIMEOUT_MS) {
      if (await this.hasDeployedCode(address)) {
        return true;
      }
      await sleep(SMART_WALLET_DEPLOYMENT_POLL_INTERVAL_MS);
    }
    return false;
  }

  private async submitAccountContractCall(target: string, targetCallData: string): Promise<SendResult> {
    const sender = await this.smartAccountAddress();
    const nonce: ethers.BigNumber = await this.tokenEntryPoint.getNonce(sender, NONCE_KEY_ZERO);
    const needsInitCode = nonce.eq(0) && !(await this.hasDeployedCode(sender));
    const accountExecuteCallData = this.encodeAccountExecuteCallData(target, targetCallData);

    const feeData = await this.provider.getFeeData();
    const maxPriorityFeePerGas =
      feeData.maxPriorityFeePerGas ?? feeData.gasPrice ?? ethers.BigNumber.from(0);
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.BigNumber.from(0);

    const callGasLimit = needsInitCode ? ethers.BigNumber.from(1_800_000) : ethers.BigNumber.from(450_000);
    const verificationGasLimit = needsInitCode
      ? ethers.BigNumber.from(2_500_000)
      : ethers.BigNumber.from(700_000);
    const preVerificationGas = needsInitCode
      ? ethers.BigNumber.from(180_000)
      : ethers.BigNumber.from(90_000);

    const initCode = needsInitCode
      ? ethers.utils.hexConcat([
          this.walletConfig.accountFactory,
          this.accountFactory.interface.encodeFunctionData("createAccount", [this.owner, this.smartIndex]),
        ])
      : "0x";

    const userOp: UserOpRPC = {
      sender,
      nonce: toHex(nonce),
      initCode,
      callData: accountExecuteCallData,
      callGasLimit: toHex(callGasLimit),
      verificationGasLimit: toHex(verificationGasLimit),
      preVerificationGas: toHex(preVerificationGas),
      maxFeePerGas: toHex(maxFeePerGas),
      maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
      paymasterAndData: "0x",
      signature: "0x",
    };

    const sponsorData = (await this.backend.sponsor(userOp, this.walletConfig.entryPoint)) as SponsorResponse;
    if (!sponsorData?.paymasterAndData) {
      throw new Error("Sponsor did not return paymasterAndData");
    }

    userOp.paymasterAndData = sponsorData.paymasterAndData;
    if (sponsorData.callGasLimit) {
      userOp.callGasLimit = normalizeHexQuantity(sponsorData.callGasLimit);
    }
    if (sponsorData.verificationGasLimit) {
      userOp.verificationGasLimit = normalizeHexQuantity(sponsorData.verificationGasLimit);
    }
    if (sponsorData.preVerificationGas) {
      userOp.preVerificationGas = normalizeHexQuantity(sponsorData.preVerificationGas);
    }
    if (sponsorData.nonce) {
      userOp.nonce = normalizeHexQuantity(sponsorData.nonce);
    }

    const userOpHash: string = await this.tokenEntryPoint.getUserOpHash(userOp);
    userOp.signature = await this.ownerSigner.signMessage(ethers.utils.arrayify(userOpHash));

    const sentUserOpHash = (await this.backend.sendUserOp(userOp, this.walletConfig.entryPoint)) as string;
    if (!sentUserOpHash) {
      throw new Error("eth_sendUserOperation returned empty hash");
    }

    for (let i = 0; i < 60; i++) {
      const receipt = await this.backend.getReceipt(sentUserOpHash);
      if (receipt) {
        const txHash = typeof receipt?.transactionHash === "string" ? receipt.transactionHash : undefined;
        return { userOpHash: sentUserOpHash, txHash };
      }
      await sleep(2_000);
    }

    return { userOpHash: sentUserOpHash };
  }

  async ensureSmartWalletDeployed(): Promise<boolean> {
    const account = await this.smartAccountAddress();
    if (await this.hasDeployedCode(account)) {
      return true;
    }

    const deploymentCallData = this.erc20.encodeFunctionData("approve", [account, ethers.constants.Zero]);
    await this.submitAccountContractCall(mobileConfig.tokenAddress, deploymentCallData);
    return this.waitForDeployedCode(account);
  }

  async recentTransfers(count = 25): Promise<AppTransaction[]> {
    const account = await this.smartAccountAddress();
    const normalizedAccount = account.toLowerCase();
    const transferTopic = this.token.interface.getEventTopic("Transfer");
    const accountTopic = ethers.utils.hexZeroPad(account, 32).toLowerCase();
    const latestBlock = await this.provider.getBlockNumber();
    const seenLogs = new Map<
      string,
      {
        blockNumber: number;
        logIndex: number;
        hash: string;
        amount: string;
        from: string;
        to: string;
      }
    >();

    let toBlock = latestBlock;
    for (let windowIndex = 0; windowIndex < MAX_TRANSFER_LOG_WINDOWS && toBlock >= 0; windowIndex++) {
      const fromBlock = Math.max(0, toBlock - TRANSFER_LOG_WINDOW + 1);
      const [outgoingLogs, incomingLogs] = await Promise.all([
        this.provider.getLogs({
          address: mobileConfig.tokenAddress,
          fromBlock,
          toBlock,
          topics: [transferTopic, accountTopic],
        }),
        this.provider.getLogs({
          address: mobileConfig.tokenAddress,
          fromBlock,
          toBlock,
          topics: [transferTopic, null, accountTopic],
        }),
      ]);

      for (const log of [...outgoingLogs, ...incomingLogs]) {
        const logKey = `${log.transactionHash}:${log.logIndex}`;
        if (seenLogs.has(logKey)) {
          continue;
        }

        const parsed = this.token.interface.parseLog(log);
        seenLogs.set(logKey, {
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          hash: log.transactionHash,
          amount: parsed.args.value.toString(),
          from: ethers.utils.getAddress(parsed.args.from),
          to: ethers.utils.getAddress(parsed.args.to),
        });
      }

      if (seenLogs.size >= count) {
        break;
      }

      toBlock = fromBlock - 1;
    }

    const sortedLogs = Array.from(seenLogs.values())
      .sort((left, right) => {
        if (left.blockNumber !== right.blockNumber) {
          return right.blockNumber - left.blockNumber;
        }
        return right.logIndex - left.logIndex;
      })
      .slice(0, count);

    const blockNumbers = [...new Set(sortedLogs.map((log) => log.blockNumber))];
    const timestamps = new Map(
      await Promise.all(
        blockNumbers.map(async (blockNumber) => {
          const block = await this.provider.getBlock(blockNumber);
          return [blockNumber, block.timestamp] as const;
        }),
      ),
    );

    return sortedLogs.map((log) => ({
      id: `${log.hash}:${log.logIndex}`,
      hash: log.hash,
      amount: log.amount,
      amountFormatted: formatTokenAmount(log.amount),
      timestamp: timestamps.get(log.blockNumber) ?? 0,
      from: log.from,
      to: log.to,
      direction: log.from.toLowerCase() === normalizedAccount ? "send" : "receive",
    }));
  }

  async watchSmartAccountTransfers(onTransfer: (txHash: string) => void): Promise<() => void> {
    const account = await this.smartAccountAddress();
    const outgoingFilter = this.token.filters.Transfer(account, null);
    const incomingFilter = this.token.filters.Transfer(null, account);

    const handleLog = (from: string, to: string, _value: ethers.BigNumber, event: ethers.Event) => {
      const normalizedAccount = account.toLowerCase();
      if (from.toLowerCase() !== normalizedAccount && to.toLowerCase() !== normalizedAccount) {
        return;
      }
      if (!event.transactionHash) {
        return;
      }
      onTransfer(event.transactionHash);
    };

    this.token.on(outgoingFilter, handleLog);
    this.token.on(incomingFilter, handleLog);

    return () => {
      this.token.off(outgoingFilter, handleLog);
      this.token.off(incomingFilter, handleLog);
    };
  }

  async sendSFLUV(
    recipientRaw: string,
    amountRaw: string,
    amountUnit: AmountUnit = "wei",
  ): Promise<SendResult> {
    if (!ethers.utils.isAddress(recipientRaw)) {
      throw new Error("Invalid recipient address");
    }
    const recipient = ethers.utils.getAddress(recipientRaw);

    let amount: ethers.BigNumber;
    try {
      amount =
        amountUnit === "token"
          ? ethers.utils.parseUnits(amountRaw.trim(), mobileConfig.tokenDecimals)
          : ethers.BigNumber.from(amountRaw.trim());
    } catch {
      throw new Error(
        amountUnit === "token"
          ? `Amount must be a valid SFLUV number with up to ${mobileConfig.tokenDecimals} decimals`
          : "Amount must be a valid integer in wei",
      );
    }
    if (amount.lte(0)) {
      throw new Error("Amount must be greater than zero");
    }

    const transferCallData = this.erc20.encodeFunctionData("transfer", [recipient, amount]);
    return this.submitAccountContractCall(mobileConfig.tokenAddress, transferCallData);
  }
}

export async function createSmartWalletServiceFromSigner(
  signer: ethers.Signer,
  selectedCandidateKey?: string,
  getAccessToken?: () => Promise<string | null>,
  options?: { forceRefresh?: boolean },
): Promise<{ service: SmartWalletService; discovery: RouteDiscovery }> {
  const ownerAddress = ethers.utils.getAddress(await signer.getAddress());
  const provider = new ethers.providers.JsonRpcProvider(mobileConfig.rpcURL, {
    chainId: mobileConfig.chainId,
    name: "berachain",
  });

  const discovery = await discoverRoutesForOwner(ownerAddress, provider, options);
  const resolvedKey = selectedCandidateKey ?? discovery.selectedCandidateKey;
  const candidate =
    discovery.candidates.find((item) => item.key === resolvedKey) ??
    discovery.candidates.find((item) => item.key === discovery.selectedCandidateKey) ??
    discovery.candidates[0] ??
    {
      key: candidateKey(0),
      smartIndex: 0,
      accountAddress: ethers.constants.AddressZero,
      deployed: false,
      tokenBalanceRaw: ethers.constants.Zero,
      tokenBalance: "0",
    };

  return {
    service: new SmartWalletService(
      signer,
      ownerAddress,
      mobileConfig.wallet,
      candidate.smartIndex,
      getAccessToken,
      candidate.accountAddress,
    ),
    discovery: {
      ...discovery,
      selectedCandidateKey: candidate.key,
    },
  };
}

export async function createSmartWalletServiceForIndex(
  signer: ethers.Signer,
  smartIndex: number,
  getAccessToken?: () => Promise<string | null>,
  smartAccountAddress?: string,
): Promise<SmartWalletService> {
  const ownerAddress = ethers.utils.getAddress(await signer.getAddress());
  return new SmartWalletService(
    signer,
    ownerAddress,
    mobileConfig.wallet,
    smartIndex,
    getAccessToken,
    smartAccountAddress,
  );
}
