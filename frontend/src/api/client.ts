const API_BASE = '/api'

export interface ApiError {
  message: string
  status: number
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error: ApiError = {
      message: body.detail || response.statusText || '请求失败',
      status: response.status,
    }
    throw error
  }
  return response.json()
}

export function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  }).then(handleResponse<T>)
}
