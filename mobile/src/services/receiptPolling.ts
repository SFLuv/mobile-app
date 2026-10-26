/**
 * Waits for a user operation's receipt, treating a failed check as "not yet".
 *
 * A failed check is not a failed payment. The operation is already with the
 * bundler, so a dropped request — a network blip, or iOS suspending the fetch
 * while the app is briefly in the background — says nothing about whether it
 * landed. Throwing on the first one is what told a merchant's customer their
 * payment failed a second after it went through, and sent the tip as a separate
 * payment. Only the receipt itself, judged by the caller, may fail a payment.
 */
export type ReceiptPollResult<R> =
  | { kind: "receipt"; receipt: R }
  /** No receipt in time. lastError is set if the final checks could not reach the network. */
  | { kind: "timeout"; lastError: unknown };

export async function pollForReceipt<R>(
  fetchReceipt: () => Promise<R | null | undefined>,
  attempts: number,
  wait: () => Promise<unknown>,
): Promise<ReceiptPollResult<R>> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const receipt = await fetchReceipt();
      lastError = null;
      if (receipt) {
        return { kind: "receipt", receipt };
      }
    } catch (error) {
      lastError = error;
      console.warn("[send] receipt check failed, retrying", error);
    }
    if (i < attempts - 1) {
      await wait();
    }
  }
  return { kind: "timeout", lastError };
}
