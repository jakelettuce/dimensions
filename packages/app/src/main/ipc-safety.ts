/**
 * Deep-clone data crossing the IPC bridge.
 * Strips __proto__, constructor, prototype keys to prevent prototype pollution.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function sanitizeIpcData<T>(data: T): T {
  if (data === null || data === undefined) return data
  if (typeof data !== 'object') return data

  // Use JSON round-trip for basic deep clone, then strip dangerous keys
  try {
    return JSON.parse(JSON.stringify(data, (key, value) => {
      if (DANGEROUS_KEYS.has(key)) return undefined
      return value
    }))
  } catch {
    // If data isn't JSON-serializable, return null
    return null as T
  }
}

/**
 * Validate that a resolved path is within an allowed directory.
 * Prevents path traversal attacks.
 */
export function assertPathWithin(resolvedPath: string, allowedDir: string): void {
  const normalized = resolvedPath.replace(/\/+$/, '')
  const normalizedDir = allowedDir.replace(/\/+$/, '')
  if (!normalized.startsWith(normalizedDir + '/') && normalized !== normalizedDir) {
    throw new Error(`Path traversal blocked: ${resolvedPath} is not within ${allowedDir}`)
  }
}
