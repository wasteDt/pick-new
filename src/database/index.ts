import type { Item, SearchQuery, SyncStatus } from "../types"
import { computeItemHash } from "../utils"

const DB_NAME = "pickquote-db"
const DB_VERSION = 3

type TableNames = "items" | "categories" | "sources"

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string,
  options?: IDBIndexParameters
) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options)
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains("items")) {
        const store = db.createObjectStore("items", { keyPath: "id" })
        ensureIndex(store, "type", "type", { unique: false })
        ensureIndex(store, "createdAt", "createdAt", { unique: false })
        ensureIndex(store, "updatedAt", "updatedAt", { unique: false })
        ensureIndex(store, "sourceSite", "sourceSite", { unique: false })
        ensureIndex(store, "categoryId", "categoryId", { unique: false })
        ensureIndex(store, "hash", "hash", { unique: false })
        ensureIndex(store, "syncStatus", "syncStatus", { unique: false })
        ensureIndex(store, "remoteId", "remoteId", { unique: false })
      } else {
        try {
          const tx = req.transaction as IDBTransaction
          const store = tx.objectStore("items")
          ensureIndex(store, "type", "type", { unique: false })
          ensureIndex(store, "createdAt", "createdAt", { unique: false })
          ensureIndex(store, "updatedAt", "updatedAt", { unique: false })
          ensureIndex(store, "sourceSite", "sourceSite", { unique: false })
          ensureIndex(store, "categoryId", "categoryId", { unique: false })
          ensureIndex(store, "hash", "hash", { unique: false })
          ensureIndex(store, "syncStatus", "syncStatus", { unique: false })
          ensureIndex(store, "remoteId", "remoteId", { unique: false })
          if (store.indexNames && (store.indexNames as any).contains?.("tags")) {
            store.deleteIndex("tags")
          }
        } catch { }
      }
      if (!db.objectStoreNames.contains("categories")) {
        const cs = db.createObjectStore("categories", { keyPath: "id" })
        cs.createIndex("name", "name", { unique: true })
      }
      if (!db.objectStoreNames.contains("sources")) {
        db.createObjectStore("sources", { keyPath: "site" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(name: TableNames, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb()
  const tx = db.transaction(name, mode)
  const store = tx.objectStore(name)
  const result = await fn(store)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
  return result
}

export async function addItem(item: Item): Promise<void> {
  const normalized: Item = {
    ...item,
    updatedAt: item.updatedAt ?? item.createdAt,
    sourceSite: item.source.site ?? new URL(item.source.url).hostname,
    hash: item.hash || (await computeItemHash(item.content, item.source.url)),
    syncStatus: item.syncStatus ?? "pending"
  }
  // simple de-dup: if hash exists for same url, skip
  const exists = await withStore("items", "readonly", async (store) => {
    const idx = store.index("hash")
    return new Promise<boolean>((resolve, reject) => {
      const req = idx.get(normalized.hash)
      req.onsuccess = () => {
        resolve(Boolean(req.result))
      }
      req.onerror = () => reject(req.error)
    })
  })
  if (exists) return

  await withStore("items", "readwrite", (store) => {
    store.put(normalized)
  })
}

export async function getRecent(limit = 10): Promise<Item[]> {
  return withStore("items", "readonly", async (store) => {
    const idx = store.index("createdAt")
    const items: Item[] = []
    return new Promise<Item[]>((resolve, reject) => {
      const cursorReq = idx.openCursor(null, "prev")
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor && items.length < limit) {
          items.push(cursor.value as Item)
          cursor.continue()
        } else {
          resolve(items)
        }
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  })
}

export async function searchItems(q: SearchQuery): Promise<Item[]> {
  return withStore("items", "readonly", async (store) => {
    const results: Item[] = []
    return new Promise<Item[]>((resolve, reject) => {
      const idx = store.index("createdAt")
      const cursorReq = idx.openCursor(null, "prev")
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) {
          resolve(results)
          return
        }
        const item = cursor.value as Item
        if (
          (!q.type || item.type === q.type) &&
          (!q.site || item.sourceSite === q.site) &&
          (!q.from || item.createdAt >= q.from) &&
          (!q.to || item.createdAt <= q.to) &&
          (!q.categoryId || item.categoryId === q.categoryId) &&
          (!q.keyword || (item.content?.toLowerCase().includes(q.keyword.toLowerCase()) || item.source.title?.toLowerCase().includes(q.keyword.toLowerCase())))
        ) {
          results.push(item)
        }
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  })
}

export async function updateItem(item: Item): Promise<void> {
  await withStore("items", "readwrite", (store) => {
    store.put({
      ...item,
      updatedAt: item.updatedAt ?? Date.now(),
      sourceSite: item.source.site ?? new URL(item.source.url).hostname
    })
  })
}

export async function getItemById(id: string): Promise<Item | undefined> {
  return withStore("items", "readonly", async (store) => {
    return new Promise<Item | undefined>((resolve, reject) => {
      const req = store.get(id)
      req.onsuccess = () => resolve(req.result as Item | undefined)
      req.onerror = () => reject(req.error)
    })
  })
}

export async function getItemByRemoteId(remoteId: string): Promise<Item | undefined> {
  return withStore("items", "readonly", async (store) => {
    const idx = store.index("remoteId")
    return new Promise<Item | undefined>((resolve, reject) => {
      const req = idx.get(remoteId)
      req.onsuccess = () => resolve(req.result as Item | undefined)
      req.onerror = () => reject(req.error)
    })
  })
}

export async function getItemByHash(hash: string): Promise<Item | undefined> {
  return withStore("items", "readonly", async (store) => {
    const idx = store.index("hash")
    return new Promise<Item | undefined>((resolve, reject) => {
      const req = idx.get(hash)
      req.onsuccess = () => resolve(req.result as Item | undefined)
      req.onerror = () => reject(req.error)
    })
  })
}

export async function getItemsBySyncStatus(
  statuses: SyncStatus[],
  limit = 50
): Promise<Item[]> {
  return withStore("items", "readonly", async (store) => {
    const idx = store.index("syncStatus")
    const items: Item[] = []

    for (const status of statuses) {
      const chunk = await new Promise<Item[]>((resolve, reject) => {
        const found: Item[] = []
        const req = idx.openCursor(IDBKeyRange.only(status))
        req.onsuccess = () => {
          const cursor = req.result
          if (cursor && found.length < limit) {
            found.push(cursor.value as Item)
            cursor.continue()
          } else {
            resolve(found)
          }
        }
        req.onerror = () => reject(req.error)
      })
      items.push(...chunk)
      if (items.length >= limit) break
    }

    return items
      .sort((a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt))
      .slice(0, limit)
  })
}

export async function patchItemSync(
  id: string,
  patch: Partial<Pick<Item, "syncStatus" | "remoteId" | "lastSyncedAt" | "updatedAt">>
): Promise<void> {
  const item = await getItemById(id)
  if (!item) return
  await updateItem({
    ...item,
    ...patch
  })
}

export async function upsertRemoteItem(remoteItem: Item): Promise<Item> {
  const normalizedRemote: Item = {
    ...remoteItem,
    sourceSite: remoteItem.source.site ?? new URL(remoteItem.source.url).hostname,
    updatedAt: remoteItem.updatedAt ?? remoteItem.createdAt,
    syncStatus: "synced",
    lastSyncedAt: Date.now()
  }

  const localByRemoteId = normalizedRemote.remoteId
    ? await getItemByRemoteId(normalizedRemote.remoteId)
    : undefined
  const localByHash = normalizedRemote.hash
    ? await getItemByHash(normalizedRemote.hash)
    : undefined
  const local = localByRemoteId ?? localByHash

  if (!local) {
    await addItem(normalizedRemote)
    await patchItemSync(normalizedRemote.id, {
      syncStatus: "synced",
      remoteId: normalizedRemote.remoteId,
      lastSyncedAt: normalizedRemote.lastSyncedAt,
      updatedAt: normalizedRemote.updatedAt
    })
    return normalizedRemote
  }

  const localUpdatedAt = local.updatedAt ?? local.createdAt
  const remoteUpdatedAt = normalizedRemote.updatedAt ?? normalizedRemote.createdAt

  if (remoteUpdatedAt > localUpdatedAt) {
    const merged: Item = {
      ...local,
      ...normalizedRemote,
      id: local.id,
      syncStatus: "synced",
      lastSyncedAt: Date.now()
    }
    await updateItem(merged)
    return merged
  }

  await patchItemSync(local.id, {
    syncStatus: "synced",
    remoteId: normalizedRemote.remoteId ?? local.remoteId,
    lastSyncedAt: Date.now()
  })
  return {
    ...local,
    remoteId: normalizedRemote.remoteId ?? local.remoteId,
    syncStatus: "synced",
    lastSyncedAt: Date.now()
  }
}

export async function listCategories(): Promise<{ id: string; name: string }[]> {
  return withStore("categories", "readonly", async (store) => {
    const all: { id: string; name: string }[] = []
    return new Promise((resolve, reject) => {
      const req = store.openCursor()
      req.onsuccess = () => {
        const c = req.result
        if (c) {
          all.push(c.value)
          c.continue()
        } else resolve(all)
      }
      req.onerror = () => reject(req.error)
    })
  })
}

export async function upsertCategory(cat: { id: string; name: string }): Promise<void> {
  await withStore("categories", "readwrite", (store) => {
    store.put(cat)
  })
}

export async function deleteCategory(id: string): Promise<void> {
  await withStore("categories", "readwrite", (store) => {
    store.delete(id)
  })
}

export async function deleteItem(id: string): Promise<void> {
  await withStore("items", "readwrite", (store) => {
    store.delete(id)
  })
}

export async function exportItems(): Promise<Item[]> {
  return withStore("items", "readonly", async (store) => {
    const all: Item[] = []
    return new Promise<Item[]>((resolve, reject) => {
      const cursorReq = store.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          all.push(cursor.value as Item)
          cursor.continue()
        } else {
          resolve(all)
        }
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  })
}
