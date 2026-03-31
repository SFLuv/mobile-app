export type UserOp = Record<string, unknown>;

export class BackendClient {
  constructor(
    private baseUrl: string,
    private chainId: number,
    private paymasterAddress: string,
    private routePaymasterType: "cw" | "cw-safe",
    private backendKind: "sfluv" | "cw-engine" = "sfluv",
    private getAccessToken?: () => Promise<string | null>,
  ) {}

  private rpcPath(): string {
    if (this.backendKind === "cw-engine") {
      return `/v1/rpc/${this.paymasterAddress}`;
    }
    return `/v1/rpc/${this.chainId}/${this.paymasterAddress}`;
  }

  private async rpc(method: string, params: unknown[]) {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${this.rpcPath()}`;
    const accessToken = this.getAccessToken ? await this.getAccessToken() : null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) {
      headers["Access-Token"] = accessToken;
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });

    const body = await res.json();
    if (body.error) {
      throw new Error(body.error.message || "RPC error");
    }

    return body.result;
  }

  async sponsor(userOp: UserOp, entryPoint: string) {
    return this.rpc("pm_sponsorUserOperation", [userOp, entryPoint, { type: this.paymasterType() }]);
  }

  async sendUserOp(userOp: UserOp, entryPoint: string) {
    return this.rpc("eth_sendUserOperation", [userOp, entryPoint]);
  }

  async getReceipt(hash: string) {
    return this.rpc("eth_getTransactionReceipt", [hash]);
  }

  private paymasterType(): "cw" | "cw-safe" {
    return this.routePaymasterType;
  }
}
