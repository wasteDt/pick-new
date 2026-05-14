import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

// 扩展端上传条目时复用的参数校验规则。
const itemInput = v.object({
  remoteId: v.optional(v.string()),
  type: v.union(
    v.literal("text"),
    v.literal("image"),
    v.literal("link"),
    v.literal("snapshot")
  ),
  content: v.string(),
  source: v.object({
    title: v.string(),
    url: v.string(),
    site: v.optional(v.string()),
    selector: v.optional(v.string()),
    anchor: v.optional(v.string())
  }),
  sourceSite: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  categoryId: v.optional(v.string()),
  note: v.optional(v.string()),
  hash: v.string(),
  deviceId: v.optional(v.string())
})

export const upsertFromSync = mutation({
  args: {
    userId: v.string(),
    item: itemInput
  },
  handler: async (ctx, args) => {
    // 优先按内容哈希查重，这样不同设备重复上报同一条内容时仍然是幂等的。
    const existingByHash = await ctx.db
      .query("items")
      .withIndex("by_user_hash", (q) =>
        q.eq("userId", args.userId).eq("hash", args.item.hash)
      )
      .first()

    // 如果客户端已经记录了云端文档 id，优先按 id 定位已有记录。
    const normalizedId = args.item.remoteId
      ? await ctx.db.normalizeId("items", args.item.remoteId)
      : null
    const existing =
      (normalizedId ? await ctx.db.get(normalizedId) : null) ?? existingByHash

    if (!existing) {
      // 云端不存在时，直接插入一条新的同步记录。
      const id = await ctx.db.insert("items", {
        ...args.item,
        userId: args.userId
      })
      return {
        _id: id,
        userId: args.userId,
        ...args.item
      }
    }

    // 以 updatedAt 为准，采用较新的版本覆盖较旧的版本。
    if (args.item.updatedAt > existing.updatedAt) {
      await ctx.db.patch(existing._id, {
        ...args.item,
        userId: args.userId
      })
    }

    const latest = await ctx.db.get(existing._id)
    return latest!
  }
})

export const listSince = query({
  args: {
    userId: v.string(),
    updatedAfter: v.number(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    // 当前只对 createdAt 建了索引，所以 updatedAt 的过滤和排序是在内存中完成的。
    const items = await ctx.db
      .query("items")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", args.userId))
      .collect()

    return items
      .filter((item) => item.updatedAt > args.updatedAfter)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, args.limit ?? 100)
  }
})

export const removeById = mutation({
  args: {
    userId: v.string(),
    remoteId: v.string()
  },
  handler: async (ctx, args) => {
    // 客户端传来的 remoteId 如果已经失效，直接忽略删除请求。
    const normalizedId = await ctx.db.normalizeId("items", args.remoteId)
    if (!normalizedId) return
    const item = await ctx.db.get(normalizedId)
    // 只允许删除当前 userId 对应的数据，避免误删其他用户记录。
    if (!item || item.userId !== args.userId) return
    await ctx.db.delete(item._id)
  }
})
