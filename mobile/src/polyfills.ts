import "react-native-get-random-values";
import "@ethersproject/shims";
import "fast-text-encoding";
import { Buffer } from "buffer";

if (typeof (globalThis as any).Buffer === "undefined") {
  (globalThis as any).Buffer = Buffer;
}
