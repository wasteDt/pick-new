import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  // 云端条目表，用于多设备之间同步摘录数据。
  items: defineTable({
    userId: v.string(),
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
    storageId: v.optional(v.string()),
    deviceId: v.optional(v.string())
  })
    // 按采集时间读取某个用户的条目列表。
    .index("by_user_createdAt", ["userId", "createdAt"])
    // 预留按条目类型筛选的能力。
    .index("by_user_type", ["userId", "type"])
    // 用于同步时按内容哈希去重，避免重复写入。
    .index("by_user_hash", ["userId", "hash"])
    // 支持按来源站点检索和统计。
    .index("by_user_site", ["userId", "sourceSite"])
})
