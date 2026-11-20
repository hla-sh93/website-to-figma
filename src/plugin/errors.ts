/** Native host failures may cross sandbox realms or arrive as plain strings. */
export function errorMessage(error: unknown, fallback = 'Operation failed.'): string {
  if (typeof error === 'string' && error) return error;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message
  )
    return error.message;
  return fallback;
}
