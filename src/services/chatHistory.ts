import { sql } from '../db/client'

export type ChatContext = 'admin' | 'customer'

export interface ModelChatMessage {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

export interface DisplayChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface ChatRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string | Date
}

let ensureChatStoragePromise: Promise<void> | null = null

export function ensureChatStorage(): Promise<void> {
  if (!ensureChatStoragePromise) {
    ensureChatStoragePromise = (async () => {
      await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`
      await sql`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          center_id   UUID REFERENCES centers(id) ON DELETE SET NULL,
          context     TEXT NOT NULL CHECK (context IN ('admin', 'customer')),
          role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content     TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
      await sql`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_profile_context_created
        ON chat_messages(profile_id, context, created_at)
      `
      await sql`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_center
        ON chat_messages(center_id)
      `
    })()
  }

  return ensureChatStoragePromise.catch((err) => {
    ensureChatStoragePromise = null
    throw err
  })
}

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function toModelRole(role: 'user' | 'assistant'): 'user' | 'model' {
  return role === 'user' ? 'user' : 'model'
}

export function toDisplayMessages(rows: ChatRow[]): DisplayChatMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: timestamp(row.created_at),
  }))
}

export function toModelHistory(rows: ChatRow[]): ModelChatMessage[] {
  return rows.map((row) => ({
    role: toModelRole(row.role),
    parts: [{ text: row.content }],
  }))
}

export async function getChatRows(profileId: string, context: ChatContext): Promise<ChatRow[]> {
  await ensureChatStorage()

  const rows = await sql`
    SELECT id, role, content, created_at
    FROM chat_messages
    WHERE profile_id = ${profileId}
      AND context = ${context}
    ORDER BY created_at ASC, id ASC
  `

  return rows as ChatRow[]
}

export async function getModelHistory(
  profileId: string,
  context: ChatContext,
  limit = 10,
): Promise<ModelChatMessage[]> {
  await ensureChatStorage()

  const rows = await sql`
    SELECT id, role, content, created_at
    FROM chat_messages
    WHERE profile_id = ${profileId}
      AND context = ${context}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `

  return toModelHistory((rows as ChatRow[]).reverse())
}

export async function appendChatExchange(params: {
  profileId: string
  centerId: string | null
  context: ChatContext
  userMessage: string
  assistantMessage: string
}): Promise<void> {
  await ensureChatStorage()

  const userCreatedAt = new Date()
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1)

  await sql`
    INSERT INTO chat_messages (profile_id, center_id, context, role, content, created_at)
    VALUES
      (
        ${params.profileId}, ${params.centerId}, ${params.context}, 'user',
        ${params.userMessage}, ${userCreatedAt.toISOString()}::timestamptz
      ),
      (
        ${params.profileId}, ${params.centerId}, ${params.context}, 'assistant',
        ${params.assistantMessage}, ${assistantCreatedAt.toISOString()}::timestamptz
      )
  `
}

export async function clearChatHistory(profileId: string, context: ChatContext): Promise<void> {
  await ensureChatStorage()

  await sql`
    DELETE FROM chat_messages
    WHERE profile_id = ${profileId}
      AND context = ${context}
  `
}
