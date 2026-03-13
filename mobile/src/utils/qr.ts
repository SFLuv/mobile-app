export type ParsedQR = {
  recipient: string;
  amount?: string;
  chainId?: number;
  token?: string;
  memo?: string;
};

const ETH_PREFIX = "ethereum:";

export function buildEIP681TransferQR(input: {
  recipient: string;
  token: string;
  amountWei?: string;
  chainId: number;
  memo?: string;
}): string {
  const { recipient, token, amountWei, chainId, memo } = input;
  const base = `${ETH_PREFIX}${token}@${chainId}/transfer?address=${recipient}`;
  const params = new URLSearchParams();
  if (amountWei) {
    params.set("uint256", amountWei);
  }
  if (memo?.trim()) {
    params.set("message", memo.trim());
  }
  const suffix = params.toString();
  if (!suffix) return base;
  return `${base}&${suffix}`;
}

export function parseTransferQR(raw: string): ParsedQR | null {
  const trimmed = raw.trim();

  if (trimmed.startsWith("0x") && trimmed.length === 42) {
    return { recipient: trimmed };
  }

  if (!trimmed.startsWith(ETH_PREFIX)) return null;

  try {
    const withoutPrefix = trimmed.slice(ETH_PREFIX.length);
    const [path, qs = ""] = withoutPrefix.split("?");
    const [tokenWithChain] = path.split("/");
    const [token, chain] = tokenWithChain.split("@");

    const params = new URLSearchParams(qs);
    const recipient = params.get("address") || "";
    const amount = params.get("uint256") || undefined;
    const memo = params.get("message") || undefined;

    if (!recipient) return null;

    return {
      recipient,
      amount,
      token,
      chainId: chain ? Number(chain) : undefined,
      memo,
    };
  } catch {
    return null;
  }
}
