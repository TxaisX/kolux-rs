// TERM-077: runs one find-bar regex search off the pane's thread, so the pane can stop a pattern that
// backtracks too long (find.ts searchLater) by ending this worker.
import { findIn, type FindOptions } from "./find";

const port = self as unknown as { onmessage: (e: MessageEvent<{ texts: string[]; query: string; opts: FindOptions }>) => void; postMessage: (m: unknown) => void };
port.onmessage = (e) => port.postMessage(findIn(e.data.texts, e.data.query, e.data.opts));
