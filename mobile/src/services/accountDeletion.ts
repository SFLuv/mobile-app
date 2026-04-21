import { ethers } from "ethers";
import { mobileConfig } from "../config";
import { AppWallet } from "../types/app";
import {
  createSmartWalletServiceForIndex,
  RouteDiscovery,
  SmartWalletService,
} from "./smartWallet";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const SWEEP_TIMEOUT_MS = 120_000;
const SWEEP_POLL_INTERVAL_MS = 2_000;

type SweepSummary = {
  checkedWallets: number;
  transferredWallets: number;
};

type SmartSweepTarget = {
  address: string;
  smartIndex: number;
};

async function waitForBalanceAtMost(
  readBalance: () => Promise<ethers.BigNumber>,
  maxBalance = ethers.constants.Zero,
): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SWEEP_TIMEOUT_MS) {
    const balance = await readBalance();
    if (balance.lte(maxBalance)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, SWEEP_POLL_INTERVAL_MS));
  }

  return false;
}

function collectSmartWalletTargets(
  ownerAddress: string,
  backendWallets: AppWallet[],
  discovery?: RouteDiscovery | null,
): SmartSweepTarget[] {
  const normalizedOwner = ownerAddress.toLowerCase();
  const targets = new Map<string, SmartSweepTarget>();

  for (const wallet of backendWallets) {
    if (
      wallet.isEoa ||
      wallet.eoaAddress.toLowerCase() !== normalizedOwner ||
      typeof wallet.smartAddress !== "string" ||
      wallet.smartAddress.trim().length === 0 ||
      typeof wallet.smartIndex !== "number"
    ) {
      continue;
    }

    const address = ethers.utils.getAddress(wallet.smartAddress);
    targets.set(address.toLowerCase(), {
      address,
      smartIndex: wallet.smartIndex,
    });
  }

  for (const candidate of discovery?.candidates ?? []) {
    targets.set(candidate.accountAddress.toLowerCase(), {
      address: ethers.utils.getAddress(candidate.accountAddress),
      smartIndex: candidate.smartIndex,
    });
  }

  return [...targets.values()].sort((left, right) => left.smartIndex - right.smartIndex);
}

export async function sweepAccessibleSFLUVToAdmin(params: {
  service: SmartWalletService;
  backendWallets: AppWallet[];
  discovery?: RouteDiscovery | null;
  adminAddress?: string;
}): Promise<SweepSummary> {
  const configuredAdminAddress = params.adminAddress?.trim() || mobileConfig.adminAddress.trim();
  if (!ethers.utils.isAddress(configuredAdminAddress)) {
    throw new Error("The account-deletion transfer destination is not configured.");
  }

  const adminAddress = ethers.utils.getAddress(configuredAdminAddress);
  const ownerAddress = ethers.utils.getAddress(params.service.ownerAddress());
  const ownerSigner = params.service.signer();
  const token = new ethers.Contract(mobileConfig.tokenAddress, ERC20_ABI, ownerSigner);
  const smartTargets = collectSmartWalletTargets(
    ownerAddress,
    params.backendWallets,
    params.discovery,
  );
  const activeSmartAddress = (await params.service.smartAccountAddress()).toLowerCase();

  let checkedWallets = 0;
  let transferredWallets = 0;

  if (ownerAddress.toLowerCase() !== adminAddress.toLowerCase()) {
    checkedWallets += 1;
    const eoaBalance = (await token.balanceOf(ownerAddress)) as ethers.BigNumber;
    if (eoaBalance.gt(0)) {
      const tx = await token.transfer(adminAddress, eoaBalance);
      await tx.wait();

      const drained = await waitForBalanceAtMost(
        async () => ((await token.balanceOf(ownerAddress)) as ethers.BigNumber),
      );
      if (!drained) {
        throw new Error("The owner wallet transfer is still pending.");
      }

      transferredWallets += 1;
    }
  }

  for (const target of smartTargets) {
    if (target.address.toLowerCase() === adminAddress.toLowerCase()) {
      continue;
    }

    checkedWallets += 1;

    const smartService =
      target.address.toLowerCase() === activeSmartAddress
        ? params.service
        : await createSmartWalletServiceForIndex(
            ownerSigner,
            target.smartIndex,
            params.service.accessTokenProvider(),
            target.address,
          );

    const smartBalance = ethers.BigNumber.from(await smartService.smartAccountBalanceRaw());
    if (smartBalance.lte(0)) {
      continue;
    }

    await smartService.sendSFLUV(adminAddress, smartBalance.toString(), "wei");

    const drained = await waitForBalanceAtMost(
      async () => ethers.BigNumber.from(await smartService.smartAccountBalanceRaw()),
    );
    if (!drained) {
      throw new Error(`Wallet ${target.smartIndex + 1} transfer is still pending.`);
    }

    transferredWallets += 1;
  }

  return {
    checkedWallets,
    transferredWallets,
  };
}
