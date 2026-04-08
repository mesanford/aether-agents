export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message?: string) {
    super(message || `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type ApiFetchOptions = RequestInit & {
  token?: string | null;
  onAuthFailure?: (status: 401) => void;
  timeoutMs?: number;
};

function mergeHeaders(existing: HeadersInit | undefined, token?: string | null): Headers {
  const headers = new Headers(existing);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

export async function apiFetch<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token, onAuthFailure, timeoutMs, ...requestInit } = options;

  const controller = timeoutMs ? new AbortController() : null;
  let didTimeout = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  if (controller) {
    if (requestInit.signal?.aborted) {
      controller.abort();
    } else if (requestInit.signal) {
      requestInit.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...requestInit,
      headers: mergeHeaders(requestInit.headers, token),
      signal: controller ? controller.signal : requestInit.signal,
    });
  } catch (error) {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (didTimeout) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  }

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    if (response.status === 401 && onAuthFailure) {
      onAuthFailure(401);
    }

    const message = typeof payload === 'object' && payload && 'error' in (payload as any)
      ? String((payload as any).error)
      : undefined;

    throw new ApiError(response.status, payload, message);
  }

  return payload as T;
}
