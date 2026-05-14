const STORAGE_KEYS = {
  deviceId: "pickquote.sync.deviceId",
  userId: "pickquote.sync.userId",
  lastPulledAt: "pickquote.sync.lastPulledAt"
} as const

export interface SyncConfig {
  convexUrl?: string
  userId: string
  deviceId: string
  lastPulledAt: number
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] as T | undefined)
    })
  })
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function getConfiguredConvexUrl(): string | undefined {
  return process.env.PLASMO_PUBLIC_CONVEX_URL?.trim() || undefined
}

function getConfiguredUserId(): string | undefined {
  return process.env.PLASMO_PUBLIC_PICKQUOTE_USER_ID?.trim() || undefined
}

export async function getSyncConfig(): Promise<SyncConfig> {
  const convexUrl = getConfiguredConvexUrl()
  const configuredUserId = getConfiguredUserId()

  let deviceId = await storageGet<string>(STORAGE_KEYS.deviceId)
  let userId = configuredUserId ?? (await storageGet<string>(STORAGE_KEYS.userId))
  const lastPulledAt =
    (await storageGet<number>(STORAGE_KEYS.lastPulledAt)) ?? 0

  const nextStoredValues: Record<string, unknown> = {}

  if (!deviceId) {
    deviceId = crypto.randomUUID()
    nextStoredValues[STORAGE_KEYS.deviceId] = deviceId
  }

  if (!userId) {
    userId = "demo-user"
    nextStoredValues[STORAGE_KEYS.userId] = userId
  }

  if (configuredUserId) {
    nextStoredValues[STORAGE_KEYS.userId] = configuredUserId
    userId = configuredUserId
  }

  if (Object.keys(nextStoredValues).length > 0) {
    await storageSet(nextStoredValues)
  }

  return {
    convexUrl,
    userId,
    deviceId,
    lastPulledAt
  }
}

export async function setLastPulledAt(timestamp: number): Promise<void> {
  await storageSet({
    [STORAGE_KEYS.lastPulledAt]: timestamp
  })
}

export async function isCloudSyncEnabled(): Promise<boolean> {
  const { convexUrl } = await getSyncConfig()
  return Boolean(convexUrl)
}
