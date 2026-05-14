import {
  addItem as addLocalItem,
  deleteItem as deleteLocalItem,
  exportItems as exportLocalItems,
  getItemById,
  getItemsBySyncStatus,
  patchItemSync,
  searchItems as searchLocalItems,
  upsertRemoteItem
} from "../database"
import {
  getSyncConfig,
  isCloudSyncEnabled,
  setLastPulledAt
} from "../sync/config"
import type { Item, SearchQuery } from "../types"

let pushSyncPromise: Promise<void> | null = null
let pullSyncPromise: Promise<number> | null = null

function canSyncItem(item: Item) {
  if (item.type === "snapshot") return false
  if (item.type === "image") return false
  if (typeof item.content === "string" && item.content.startsWith("data:image")) {
    return false
  }
  return true
}

export async function saveCapturedItem(item: Item): Promise<void> {
  const { deviceId } = await getSyncConfig()
  const createdAt = item.createdAt ?? Date.now()

  await addLocalItem({
    ...item,
    createdAt,
    updatedAt: item.updatedAt ?? createdAt,
    deviceId,
    syncStatus: "pending"
  })

  void syncPendingItems()
}

export async function searchItems(q: SearchQuery): Promise<Item[]> {
  return searchLocalItems(q)
}

export async function exportItems(): Promise<Item[]> {
  return exportLocalItems()
}

export async function deleteItem(id: string): Promise<void> {
  const item = await getItemById(id)
  await deleteLocalItem(id)

  if (!item?.remoteId) return
  if (!(await isCloudSyncEnabled())) return

  const { convexUrl, userId } = await getSyncConfig()
  if (!convexUrl) return
  const { deleteCloudItem } = await import("../sync/convex")

  void deleteCloudItem(convexUrl, userId, item.remoteId).catch((error) => {
    console.warn("Remote delete failed:", error)
  })
}

export async function syncPendingItems(): Promise<void> {
  if (pushSyncPromise) return pushSyncPromise

  pushSyncPromise = (async () => {
    const { convexUrl, userId } = await getSyncConfig()
    if (!convexUrl) return
    const { pushItemToCloud } = await import("../sync/convex")

    const pendingItems = await getItemsBySyncStatus(["pending", "failed"], 100)

    for (const item of pendingItems) {
      if (!canSyncItem(item)) continue

      try {
        const remote = await pushItemToCloud(convexUrl, userId, item)
        await patchItemSync(item.id, {
          syncStatus: "synced",
          remoteId: remote._id,
          lastSyncedAt: Date.now(),
          updatedAt: Math.max(item.updatedAt ?? item.createdAt, remote.updatedAt)
        })
      } catch (error) {
        await patchItemSync(item.id, {
          syncStatus: "failed"
        })
        console.warn("Cloud sync push failed:", error)
      }
    }
  })().finally(() => {
    pushSyncPromise = null
  })

  return pushSyncPromise
}

export async function syncFromCloud(): Promise<number> {
  if (pullSyncPromise) return pullSyncPromise

  pullSyncPromise = (async () => {
    const { convexUrl, userId, lastPulledAt } = await getSyncConfig()
    if (!convexUrl) return 0
    const { pullItemsSince } = await import("../sync/convex")

    const remoteItems = await pullItemsSince(convexUrl, userId, lastPulledAt, 100)
    let maxUpdatedAt = lastPulledAt

    for (const remote of remoteItems) {
      const localItem: Item = {
        id: `remote:${remote._id}`,
        remoteId: remote._id,
        type: remote.type,
        content: remote.content,
        source: remote.source,
        sourceSite: remote.sourceSite,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
        categoryId: remote.categoryId,
        note: remote.note,
        hash: remote.hash,
        lastSyncedAt: Date.now(),
        syncStatus: "synced",
        deviceId: remote.deviceId
      }

      await upsertRemoteItem(localItem)
      maxUpdatedAt = Math.max(maxUpdatedAt, remote.updatedAt)
    }

    if (maxUpdatedAt > lastPulledAt) {
      await setLastPulledAt(maxUpdatedAt)
    }

    return remoteItems.length
  })().finally(() => {
    pullSyncPromise = null
  })

  return pullSyncPromise
}

export async function runBackgroundSync(): Promise<void> {
  if (!(await isCloudSyncEnabled())) return

  await syncFromCloud().catch((error) => {
    console.warn("Cloud sync pull failed:", error)
  })

  await syncPendingItems().catch((error) => {
    console.warn("Cloud sync push failed:", error)
  })
}
