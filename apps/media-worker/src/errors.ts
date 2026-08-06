const MAX_ERROR_LENGTH = 500;

// campaign_creatives.processing_error is shown to staff in the admin
// panel — same rule as impressions.failure_reason (see the column
// comment in 20260822090000_media_processing_pipeline.sql): a short,
// user-safe description, never a raw stack trace or a filesystem path
// that could leak the worker's local layout.
export function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = message.split('\n')[0];
  const withoutPaths = firstLine.replace(/\/[^\s'"]+/g, '<path>');
  return withoutPaths.length > MAX_ERROR_LENGTH
    ? `${withoutPaths.slice(0, MAX_ERROR_LENGTH)}…`
    : withoutPaths;
}
