export function fail(status: number, message: string): never {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = status;
  throw error;
}
