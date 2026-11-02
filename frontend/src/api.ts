export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  roles: { role: string; isActive: boolean }[];
  permissions: string[];
  companyId: number | null;
  kycVerified: boolean;
};

export class ApiError extends Error {
  status: number;
  issues?: { path: string; message: string }[];

  constructor(status: number, message: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

let token = localStorage.getItem('hi_token');

export function setToken(value: string | null): void {
  token = value;
  if (value) localStorage.setItem('hi_token', value);
  else localStorage.removeItem('hi_token');
}

export function hasToken(): boolean {
  return Boolean(token);
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401) {
    setToken(null);
    localStorage.removeItem('hi_user');
    window.location.reload();
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error ?? `Request failed (${response.status})`,
      data?.issues,
    );
  }
  return data;
}

export async function upload<T = any>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`/v1${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data?.error ?? 'Upload failed');
  return data;
}

export const money = (value: unknown): string =>
  value === null || value === undefined ? '—' : String(value);
