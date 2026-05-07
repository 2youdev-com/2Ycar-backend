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

export interface ChatSessionSummary {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface ChatRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string | Date
}

interface SessionRow {
  id: string
  profile_id: string
  context: ChatContext
  title: string | null
  created_at: string | Date
  updated_at: string | Date
}

let ensureChatStoragePromise: Promise<void> | null = null

export function ensureChatStorage(): Promise<void> {
  if (!ensureChatStoragePromise) {
    ensureChatStoragePromise = (async () => {
      await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`

      await sql`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          context     TEXT NOT NULL CHECK (context IN ('admin', 'customer')),
          title       TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `

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
        ALTER TABLE chat_messages
        ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE
      `

      // Migrate orphan messages (from before sessions existed): one session per (profile, context).
      const orphans = (await sql`
        SELECT DISTINCT profile_id, context FROM chat_messages WHERE session_id IS NULL
      `) as Array<{ profile_id: string; context: ChatContext }>
      for (const orphan of orphans) {
        const [session] = (await sql`
          INSERT INTO chat_sessions (profile_id, context, title, created_at, updated_at)
          SELECT ${orphan.profile_id}, ${orphan.context}, 'محادثة سابقة',
                 MIN(created_at), MAX(created_at)
          FROM chat_messages
          WHERE profile_id = ${orphan.profile_id} AND context = ${orphan.context} AND session_id IS NULL
          RETURNING id
        `) as Array<{ id: string }>
        await sql`
          UPDATE chat_messages
          SET session_id = ${session.id}
          WHERE profile_id = ${orphan.profile_id} AND context = ${orphan.context} AND session_id IS NULL
        `
      }

      await sql`
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_profile_context_updated
        ON chat_sessions(profile_id, context, updated_at DESC)
      `
      await sql`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
        ON chat_messages(session_id, created_at)
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

function summarize(row: SessionRow & { message_count: number | string }): ChatSessionSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    messageCount: Number(row.message_count) || 0,
  }
}

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 40) return trimmed
  return trimmed.slice(0, 40) + '…'
}

export async function listSessions(
  profileId: string,
  context: ChatContext,
): Promise<ChatSessionSummary[]> {
  await ensureChatStorage()

  const rows = await sql`
    SELECT s.id, s.profile_id, s.context, s.title, s.created_at, s.updated_at,
      (SELECT COUNT(*)::int FROM chat_messages m WHERE m.session_id = s.id) AS message_count
    FROM chat_sessions s
    WHERE s.profile_id = ${profileId}
      AND s.context = ${context}
    ORDER BY s.updated_at DESC, s.created_at DESC
  `

  return (rows as Array<SessionRow & { message_count: number | string }>).map(summarize)
}

export async function createSession(
  profileId: string,
  context: ChatContext,
  title: string | null = null,
): Promise<ChatSessionSummary> {
  await ensureChatStorage()

  const rows = (await sql`
    INSERT INTO chat_sessions (profile_id, context, title)
    VALUES (${profileId}, ${context}, ${title})
    RETURNING id, profile_id, context, title, created_at, updated_at
  `) as SessionRow[]

  return summarize({ ...rows[0], message_count: 0 })
}

export async function getSessionRows(
  sessionId: string,
  profileId: string,
  context: ChatContext,
): Promise<ChatRow[] | null> {
  await ensureChatStorage()

  const sessions = await sql`
    SELECT id FROM chat_sessions
    WHERE id = ${sessionId} AND profile_id = ${profileId} AND context = ${context}
  `
  if ((sessions as unknown[]).length === 0) return null

  const rows = await sql`
    SELECT id, role, content, created_at
    FROM chat_messages
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC, id ASC
  `

  return rows as ChatRow[]
}

export async function getSessionModelHistory(
  sessionId: string,
  profileId: string,
  context: ChatContext,
  limit = 10,
): Promise<ModelChatMessage[]> {
  await ensureChatStorage()

  const sessions = await sql`
    SELECT id FROM chat_sessions
    WHERE id = ${sessionId} AND profile_id = ${profileId} AND context = ${context}
  `
  if ((sessions as unknown[]).length === 0) return []

  const rows = await sql`
    SELECT id, role, content, created_at
    FROM chat_messages
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `

  return toModelHistory((rows as ChatRow[]).reverse())
}

export async function deleteSession(
  sessionId: string,
  profileId: string,
  context: ChatContext,
): Promise<boolean> {
  await ensureChatStorage()

  const result = await sql`
    DELETE FROM chat_sessions
    WHERE id = ${sessionId} AND profile_id = ${profileId} AND context = ${context}
    RETURNING id
  `

  return (result as unknown[]).length > 0
}

export async function appendChatExchange(params: {
  sessionId: string
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
    INSERT INTO chat_messages (session_id, profile_id, center_id, context, role, content, created_at)
    VALUES
      (
        ${params.sessionId}, ${params.profileId}, ${params.centerId}, ${params.context},
        'user', ${params.userMessage}, ${userCreatedAt.toISOString()}::timestamptz
      ),
      (
        ${params.sessionId}, ${params.profileId}, ${params.centerId}, ${params.context},
        'assistant', ${params.assistantMessage}, ${assistantCreatedAt.toISOString()}::timestamptz
      )
  `

  // Auto-set title from first user message and bump updated_at.
  await sql`
    UPDATE chat_sessions
    SET updated_at = ${assistantCreatedAt.toISOString()}::timestamptz,
        title = COALESCE(title, ${deriveTitle(params.userMessage)})
    WHERE id = ${params.sessionId}
  `
}
