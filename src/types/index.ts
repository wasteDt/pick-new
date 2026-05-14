export type ItemType = "text" | "image" | "link" | "snapshot"
export type SyncStatus = "pending" | "synced" | "failed"

export interface SourceMeta {
  title: string
  url: string
  site?: string
  selector?: string
  anchor?: string
}

export interface Item {
  id: string
  type: ItemType
  content: string
  context?: {
    before?: string
    after?: string
    paragraph?: string
  }
  source: SourceMeta
  createdAt: number
  updatedAt?: number
  categoryId?: string
  note?: string
  hash?: string
  syncStatus?: SyncStatus
  remoteId?: string
  lastSyncedAt?: number
  deviceId?: string
  /** Derived field for indexing */
  sourceSite?: string
}

export interface SearchQuery {
  keyword?: string
  site?: string
  type?: ItemType
  from?: number
  to?: number
  categoryId?: string
}

export interface Category {
  id: string
  name: string
}
