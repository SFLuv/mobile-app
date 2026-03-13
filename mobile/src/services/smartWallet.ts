import { ethers } from "ethers";
import { BackendClient } from "../api/client";
import { mobileConfig, RouteID, WalletRouteConfig } from "../config";

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
  route: WalletRouteConfig;
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
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
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

function routeFromID(routeID: RouteID): WalletRouteConfig {
  return mobileConfig.routes[routeID];
}

function sortRoutes(routeMap: Record<RouteID, WalletRouteConfig>): WalletRouteConfig[] {
  const ordered: WalletRouteConfig[] = [];
  const seen = new Set<RouteID>();
  for (const id of mobileConfig.routePriority) {
    if (!seen.has(id) && routeMap[id]) {
      ordered.push(routeMap[id]);
      seen.add(id);
    }
  }
  for (const id of ["legacy", "new"] as RouteID[]) {
    if (!seen.has(id) && routeMap[id]) {
      ordered.push(routeMap[id]);
      seen.add(id);
    }
  }
  return ordered;
}

function candidateKey(routeID: RouteID, smartIndex: number): string {
  return `${routeID}:${smartIndex}`;
}

function resolveSelectedCandidate(candidates: RouteCandidate[]): string {
  if (candidates.length === 0) {
    return candidateKey("new", 0);
  }

  if (mobileConfig.forceRoute) {
    const forced = candidates.find((candidate) => candidate.route.id === mobileConfig.forceRoute);
    if (forced) {
      return forced.key;
    }
  }

  const legacyPrimary = candidates.find((candidate) => candidate.route.id === "legacy" && candidate.smartIndex === 0);
  const newPrimary = candidates.find((candidate) => candidate.route.id === "new" && candidate.smartIndex === 0);

  if (mobileConfig.preferLegacyIfDeployed && legacyPrimary) {
    if (legacyPrimary.deployed || legacyPrimary.tokenBalanceRaw.gt(0)) {
      return legacyPrimary.key;
    }
  }

  if (newPrimary) {
    return newPrimary.key;
  }

  if (legacyPrimary) {
    return legacyPrimary.key;
  }

  return candidates[0].key;
}

export async function discoverRoutesForOwner(
  ownerAddress: string,
  provider: ethers.providers.JsonRpcProvider,
): Promise<RouteDiscovery> {
  const token = new ethers.Contract(mobileConfig.tokenAddress, ERC20_ABI, provider);
  const routes = sortRoutes(mobileConfig.routes);
  const candidates: RouteCandidate[] = [];

  for (const route of routes) {
    const factory = new ethers.Contract(route.accountFactory, ACCOUNT_FACTORY_ABI, provider);
    for (let smartIndex = 0; smartIndex < mobileConfig.maxSmartAccountScan; smartIndex++) {
      const accountAddress = ethers.utils.getAddress(await factory.getAddress(ownerAddress, smartIndex));
      const code = await provider.getCode(accountAddress);
      const tokenBalanceRaw: ethers.BigNumber = await token.balanceOf(accountAddress);
      const deployed = code !== "0x";
      const include = smartIndex === 0 || deployed || tokenBalanceRaw.gt(0);

      if (include) {
        candidates.push({
          key: candidateKey(route.id, smartIndex),
          route,
          smartIndex,
          accountAddress,
          deployed,
          tokenBalanceRaw,
          tokenBalance: ethers.utils.formatUnits(tokenBalanceRaw, mobileConfig.tokenDecimals),
        });
      }

      if (smartIndex > 0 && !deployed && tokenBalanceRaw.eq(0)) {
        // Account indexes are typically sequential; stop after the first empty gap.
        break;
      }
    }
  }

  const selectedCandidateKey = resolveSelectedCandidate(candidates);
  return { ownerAddress, selectedCandidateKey, candidates };
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

  constructor(
    private readonly ownerSigner: ethers.Signer,
    private readonly owner: string,
    private readonly route: WalletRouteConfig,
    private readonly smartIndex: number,
  ) {
    this.provider = new ethers.providers.JsonRpcProvider(mobileConfig.rpcURL, {
      chainId: mobileConfig.chainId,
      name: "berachain",
    });
    this.backend = new BackendClient(
      route.backendURL,
      mobileConfig.chainId,
      route.paymasterAddress,
      route.paymasterType,
      route.backendKind,
    );

    this.erc20 = new ethers.utils.Interface(ERC20_ABI);
    this.token = new ethers.Contract(mobileConfig.tokenAddress, ERC20_ABI, this.provider);
    this.account = new ethers.utils.Interface(ACCOUNT_ABI);
    this.safeAccount = new ethers.utils.Interface(SAFE_ACCOUNT_ABI);
    this.accountFactory = new ethers.Contract(route.accountFactory, ACCOUNT_FACTORY_ABI, this.provider);
    this.tokenEntryPoint = new ethers.Contract(route.entryPoint, TOKEN_ENTRYPOINT_ABI, this.provider);
  }

  ownerAddress(): string {
    return this.owner;
  }

  routeConfig(): WalletRouteConfig {
    return this.route;
  }

  smartAccountIndex(): number {
    return this.smartIndex;
  }

  async smartAccountAddress(): Promise<string> {
    const address = await this.accountFactory.getAddress(this.owner, this.smartIndex);
    return ethers.utils.getAddress(address);
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

    const sender = await this.smartAccountAddress();
    const nonce: ethers.BigNumber = await this.tokenEntryPoint.getNonce(sender, NONCE_KEY_ZERO);
    const code = await this.provider.getCode(sender);
    const needsInitCode = nonce.eq(0) && code === "0x";

    const transferCallData = this.erc20.encodeFunctionData("transfer", [recipient, amount]);
    const accountExecuteCallData =
      this.route.paymasterType === "cw-safe"
        ? this.safeAccount.encodeFunctionData("execTransactionFromModule", [
            mobileConfig.tokenAddress,
            0,
            transferCallData,
            0, // operation = call
          ])
        : this.account.encodeFunctionData("execute", [
            mobileConfig.tokenAddress,
            0,
            transferCallData,
          ]);

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
          this.route.accountFactory,
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

    const sponsorData = (await this.backend.sponsor(userOp, this.route.entryPoint)) as SponsorResponse;
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

    const sentUserOpHash = (await this.backend.sendUserOp(userOp, this.route.entryPoint)) as string;
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
}

export async function createSmartWalletServiceFromSigner(
  signer: ethers.Signer,
  selectedCandidateKey?: string,
): Promise<{ service: SmartWalletService; discovery: RouteDiscovery }> {
  const ownerAddress = ethers.utils.getAddress(await signer.getAddress());
  const provider = new ethers.providers.JsonRpcProvider(mobileConfig.rpcURL, {
    chainId: mobileConfig.chainId,
    name: "berachain",
  });

  const discovery = await discoverRoutesForOwner(ownerAddress, provider);
  const resolvedKey = selectedCandidateKey ?? discovery.selectedCandidateKey;
  const candidate =
    discovery.candidates.find((item) => item.key === resolvedKey) ??
    discovery.candidates.find((item) => item.key === discovery.selectedCandidateKey) ??
    discovery.candidates[0] ??
    {
      key: candidateKey("new", 0),
      route: routeFromID("new"),
      smartIndex: 0,
      accountAddress: ethers.constants.AddressZero,
      deployed: false,
      tokenBalanceRaw: ethers.constants.Zero,
      tokenBalance: "0",
    };

  return {
    service: new SmartWalletService(signer, ownerAddress, candidate.route, candidate.smartIndex),
    discovery,
  };
}

function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Missing EXPO_PUBLIC_TEST_OWNER_PRIVATE_KEY");
  }
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error("Invalid EXPO_PUBLIC_TEST_OWNER_PRIVATE_KEY");
  }
  return withPrefix;
}

export async function createSmartWalletServiceFromTestKey(
  selectedCandidateKey?: string,
): Promise<{
  service: SmartWalletService;
  discovery: RouteDiscovery;
}> {
  const pk = normalizePrivateKey(mobileConfig.testOwnerPrivateKey);
  const provider = new ethers.providers.JsonRpcProvider(mobileConfig.rpcURL, {
    chainId: mobileConfig.chainId,
    name: "berachain",
  });
  const signer = new ethers.Wallet(pk, provider);
  return createSmartWalletServiceFromSigner(signer, selectedCandidateKey);
}
