import { Router, Response } from 'express'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'
import { processChat, processCustomerChat } from '../services/chat'
import {
  appendChatExchange,
  ChatContext,
  createSession,
  deleteSession,
  getSessionModelHistory,
  getSessionRows,
  listSessions,
  toDisplayMessages,
} from '../services/chatHistory'

export const chatRouter = Router()

// ── helpers ─────────────────────────────────────────────────────

async function handleListSessions(
  req: AuthRequest,
  res: Response,
  context: ChatContext,
) {
  try {
    const sessions = await listSessions(req.user!.id, context)
    return res.json({ sessions })
  } catch (err) {
    console.error(`[ChatSessions:${context}] Failed to list:`, err)
    return res.status(500).json({ error: 'Failed to load chat sessions' })
  }
}

async function handleCreateSession(
  req: AuthRequest,
  res: Response,
  context: ChatContext,
) {
  try {
    const session = await createSession(req.user!.id, context)
    return res.status(201).json({ session })
  } catch (err) {
    console.error(`[ChatSessions:${context}] Failed to create:`, err)
    return res.status(500).json({ error: 'Failed to create chat session' })
  }
}

async function handleGetSession(
  req: AuthRequest,
  res: Response,
  context: ChatContext,
) {
  const sessionId = req.params.id
  try {
    const rows = await getSessionRows(sessionId, req.user!.id, context)
    if (rows === null) {
      return res.status(404).json({ error: 'الشات مش موجود' })
    }
    return res.json({ messages: toDisplayMessages(rows) })
  } catch (err) {
    console.error(`[ChatSessions:${context}] Failed to load session ${sessionId}:`, err)
    return res.status(500).json({ error: 'Failed to load chat session' })
  }
}

async function handleDeleteSession(
  req: AuthRequest,
  res: Response,
  context: ChatContext,
) {
  const sessionId = req.params.id
  try {
    const ok = await deleteSession(sessionId, req.user!.id, context)
    if (!ok) {
      return res.status(404).json({ error: 'الشات مش موجود' })
    }
    return res.json({ success: true })
  } catch (err) {
    console.error(`[ChatSessions:${context}] Failed to delete session ${sessionId}:`, err)
    return res.status(500).json({ error: 'Failed to delete chat session' })
  }
}

// ── Admin chat ──────────────────────────────────────────────────

chatRouter.get('/sessions', requireAuth, requireAdmin, (req: AuthRequest, res) =>
  handleListSessions(req, res, 'admin'),
)

chatRouter.post('/sessions', requireAuth, requireAdmin, (req: AuthRequest, res) =>
  handleCreateSession(req, res, 'admin'),
)

chatRouter.get('/sessions/:id', requireAuth, requireAdmin, (req: AuthRequest, res) =>
  handleGetSession(req, res, 'admin'),
)

chatRouter.delete('/sessions/:id', requireAuth, requireAdmin, (req: AuthRequest, res) =>
  handleDeleteSession(req, res, 'admin'),
)

chatRouter.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id
  if (!centerId) {
    return res.status(400).json({ error: 'لا يوجد مركز مرتبط بهذا الحساب' })
  }

  const { message, sessionId: rawSessionId } = req.body as {
    message?: unknown
    sessionId?: unknown
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'الرسالة مطلوبة' })
  }

  const trimmedMessage = message.trim()

  try {
    let sessionId =
      typeof rawSessionId === 'string' && rawSessionId.length > 0 ? rawSessionId : null

    if (sessionId) {
      const exists = await getSessionRows(sessionId, req.user!.id, 'admin')
      if (exists === null) sessionId = null
    }

    if (!sessionId) {
      const newSession = await createSession(req.user!.id, 'admin')
      sessionId = newSession.id
    }

    const trimmedHistory = await getSessionModelHistory(sessionId, req.user!.id, 'admin', 10)
    const result = await processChat(trimmedMessage, centerId, trimmedHistory)

    await appendChatExchange({
      sessionId,
      profileId: req.user!.id,
      centerId,
      context: 'admin',
      userMessage: trimmedMessage,
      assistantMessage: result.reply,
    })

    const rows = await getSessionRows(sessionId, req.user!.id, 'admin')
    return res.json({
      reply: result.reply,
      sessionId,
      messages: toDisplayMessages(rows ?? []),
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Chat] Error:', errMsg)
    return res.status(500).json({
      error: 'فشل معالجة الرسالة',
      reply: `عذراً، حصلت مشكلة: ${errMsg}`,
    })
  }
})

// ── Customer chat ───────────────────────────────────────────────

function requireCustomer(req: AuthRequest, res: Response): boolean {
  if (req.user!.role !== 'customer') {
    res.status(403).json({ error: 'هذه الخدمة متاحة للعملاء فقط' })
    return false
  }
  return true
}

chatRouter.get('/customer/sessions', requireAuth, (req: AuthRequest, res) => {
  if (!requireCustomer(req, res)) return
  return handleListSessions(req, res, 'customer')
})

chatRouter.post('/customer/sessions', requireAuth, (req: AuthRequest, res) => {
  if (!requireCustomer(req, res)) return
  return handleCreateSession(req, res, 'customer')
})

chatRouter.get('/customer/sessions/:id', requireAuth, (req: AuthRequest, res) => {
  if (!requireCustomer(req, res)) return
  return handleGetSession(req, res, 'customer')
})

chatRouter.delete('/customer/sessions/:id', requireAuth, (req: AuthRequest, res) => {
  if (!requireCustomer(req, res)) return
  return handleDeleteSession(req, res, 'customer')
})

chatRouter.post('/customer', requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireCustomer(req, res)) return

  const { message, sessionId: rawSessionId } = req.body as {
    message?: unknown
    sessionId?: unknown
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'الرسالة مطلوبة' })
  }

  const trimmedMessage = message.trim()

  try {
    let sessionId =
      typeof rawSessionId === 'string' && rawSessionId.length > 0 ? rawSessionId : null

    if (sessionId) {
      const exists = await getSessionRows(sessionId, req.user!.id, 'customer')
      if (exists === null) sessionId = null
    }

    if (!sessionId) {
      const newSession = await createSession(req.user!.id, 'customer')
      sessionId = newSession.id
    }

    const trimmedHistory = await getSessionModelHistory(sessionId, req.user!.id, 'customer', 10)
    const result = await processCustomerChat(
      trimmedMessage,
      req.user!.id,
      req.user!.center_id,
      trimmedHistory,
    )

    await appendChatExchange({
      sessionId,
      profileId: req.user!.id,
      centerId: req.user!.center_id,
      context: 'customer',
      userMessage: trimmedMessage,
      assistantMessage: result.reply,
    })

    const rows = await getSessionRows(sessionId, req.user!.id, 'customer')
    return res.json({
      reply: result.reply,
      sessionId,
      messages: toDisplayMessages(rows ?? []),
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[CustomerChat] Error:', errMsg)
    return res.status(500).json({
      error: 'فشل معالجة الرسالة',
      reply: `عذراً، حصلت مشكلة: ${errMsg}`,
    })
  }
})
