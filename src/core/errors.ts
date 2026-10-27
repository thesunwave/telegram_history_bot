/**
 * Extracts a readable message from a value caught in a `catch` block.
 * TypeScript types caught values as `unknown`, so callers should not read
 * `.message` directly.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
