import { setTimeout as delay } from "node:timers/promises";

const TRANSIENT_FILESYSTEM_ERROR_CODES = new Set([
  "EACCES",
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "EPERM",
]);

const TRANSIENT_FILESYSTEM_RETRY_DELAYS_MS = [25, 50, 100, 200];

function isTransientFilesystemError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && typeof (error as NodeJS.ErrnoException).code === "string"
    && TRANSIENT_FILESYSTEM_ERROR_CODES.has((error as NodeJS.ErrnoException).code!),
  );
}

export async function retryTransientFilesystemError<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientFilesystemError(error) || attempt >= TRANSIENT_FILESYSTEM_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(TRANSIENT_FILESYSTEM_RETRY_DELAYS_MS[attempt]!);
    }
  }
}
