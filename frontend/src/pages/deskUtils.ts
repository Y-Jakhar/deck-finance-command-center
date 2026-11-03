export async function deskApi(path: string, body?: unknown, method = 'POST') {
  const response = await fetch('/api/desk' + path, body === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  let data: any
  try {
    data = await response.json()
  } catch {
    throw new Error(response.ok ? 'Research service returned an invalid response.' : `Research service unavailable (HTTP ${response.status || 'error'}).`)
  }
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `Research service unavailable (HTTP ${response.status || 'error'}).`)
  return data
}

export const fmt = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString(undefined, { maximumFractionDigits: 3 })
