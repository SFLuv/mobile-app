import { REQUEST_ID_HEADER, newRequestId, recordRequest, reportRequestFailure } from "../services/observability";

export type UserOp = Record<string, unknown>;

/**
 * Receipt polling asks dozens of times per payment and expects "not yet", so
 * only these methods report failures; the rest leave steps in the trail.
 */
const REPORTED_RPC_METHODS = new Set(["pm_sponsorUserOperation", "eth_sendUserOperation"]);

const CW_ENGINE_REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutID = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timeoutID);
  }
}

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
    const requestId = newRequestId();
    headers[REQUEST_ID_HEADER] = requestId;
    const startedAt = Date.now();
    const base = { kind: "rpc" as const, method: "POST", target: method, requestId };

    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }, CW_ENGINE_REQUEST_TIMEOUT_MS);
    } catch (error) {
      const failure = (error as Error)?.name === "AbortError" ? "timed out" : "no response";
      recordRequest({ ...base, durationMs: Date.now() - startedAt, failure });
      throw error;
    }

    const body = await res.json();
    const record = { ...base, status: res.status, durationMs: Date.now() - startedAt };
    recordRequest(body.error ? { ...record, failure: "rpc error" } : record);
    if (body.error) {
      if (REPORTED_RPC_METHODS.has(method)) {
        reportRequestFailure({ ...record, failure: "rpc error", detail: body.error.message });
      }
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
