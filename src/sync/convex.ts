import { ConvexHttpClient } from "convex/browser"
import { anyApi } from "convex/server"

import type { Item } from "../types"

export interface CloudItemRecord {
  _id: string
  userId: string
  type: Item["type"]
  content: string
  source: Item["source"]
  sourceSite: string
  createdAt: number
  updatedAt: number
  categoryId?: string
  note?: string
  hash: string
  storageId?: string
  deviceId?: string
}

const clients = new Map<string, ConvexHttpClient>()

function getClient(convexUrl: string): ConvexHttpClient {
  const cached = clients.get(convexUrl)
  if (cached) return cached

  const client = new ConvexHttpClient(convexUrl)
  clients.set(convexUrl, client)
  return client
}

function getApi() {
  return anyApi as any
}

export async function pushItemToCloud(
  convexUrl: string,
  userId: string,
  item: Item
): Promise<CloudItemRecord> {
  const client = getClient(convexUrl)
  return client.mutation(getApi().items.upsertFromSync, {
    userId,
    item: {
      remoteId: item.remoteId,
      type: item.type,
      content: item.content,
      source: item.source,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt ?? item.createdAt,
      categoryId: item.categoryId,
      note: item.note,
      hash: item.hash,
      deviceId: item.deviceId,
      sourceSite: item.sourceSite ?? item.source.site ?? new URL(item.source.url).hostname
    }
  })
}

export async function pullItemsSince(
  convexUrl: string,
  userId: string,
  updatedAfter: number,
  limit = 100
): Promise<CloudItemRecord[]> {
  const client = getClient(convexUrl)
  return client.query(getApi().items.listSince, {
    userId,
    updatedAfter,
    limit
  })
}

export async function deleteCloudItem(
  convexUrl: string,
  userId: string,
  remoteId: string
): Promise<void> {
  const client = getClient(convexUrl)
  await client.mutation(getApi().items.removeById, {
    userId,
    remoteId
  })
}
