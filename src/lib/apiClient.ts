export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status === 401 ? 'Session expired. Sign in again; your saved data has not been deleted.' : data?.error || `Request failed (${response.status}). Please retry.`, response.status);
  return data as T;
}
