import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch } from './client'

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses successful JSON response', async () => {
    const mockData = [{ id: 1, status: 'success' }]
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const result = await apiFetch('/metadata/jobs')
    expect(result).toEqual(mockData)
    expect(fetch).toHaveBeenCalledWith('/api/metadata/jobs', expect.any(Object))
  })

  it('throws on error response with detail', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ detail: '任务不存在' }),
    })

    await expect(apiFetch('/metadata/jobs/999')).rejects.toEqual({
      message: '任务不存在',
      status: 404,
    })
  })
})
