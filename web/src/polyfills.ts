// Some wallet libraries (Wallet Selector, @near-js/*) expect Node's Buffer.
// Must be imported before anything else in main.tsx.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
