import { Router, Response } from 'express'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'
import { processChat, processCustomerChat } from '../services/chat'
import {
  appendChatExchange,
  clearChatHistory,
  getChatRows,
  getModelHistory,
  toDisplayMessages,
  toModelHistory,
} from '../services/chatHistory'

export const chatRouter = Router()

// GET /api/v1/chat/history - persisted admin AI assistant messages
chatRouter.get('/history', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await getChatRows(req.user!.id, 'admin')
    return res.json({
      messages: toDisplayMessages(rows),
      history: toModelHistory(rows),
    })
  } catch (err) {
    console.error('[ChatHistory] Failed to load admin history:', err)
    return res.status(500).json({ error: 'Failed to load chat history' })
  }
})

// DELETE /api/v1/chat/history - clear persisted admin AI assistant messages
chatRouter.delete('/history', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await clearChatHistory(req.user!.id, 'admin')
    return res.json({ success: true, messages: [], history: [] })
  } catch (err) {
    console.error('[ChatHistory] Failed to clear admin history:', err)
    return res.status(500).json({ error: 'Failed to clear chat history' })
  }
})

// POST /api/v1/chat — send a message to the AI assistant (admin)
chatRouter.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id
  if (!centerId) {
    return res.status(400).json({ error: 'لا يوجد مركز مرتبط بهذا الحساب' })
  }

  const { message } = req.body

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'الرسالة مطلوبة' })
  }

  try {
    const trimmedHistory = await getModelHistory(req.user!.id, 'admin', 10)
    const result = await processChat(message.trim(), centerId, trimmedHistory)
    await appendChatExchange({
      profileId: req.user!.id,
      centerId,
      context: 'admin',
      userMessage: message.trim(),
      assistantMessage: result.reply,
    })
    const rows = await getChatRows(req.user!.id, 'admin')
    return res.json({
      ...result,
      messages: toDisplayMessages(rows),
      history: toModelHistory(rows),
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

// GET /api/v1/chat/customer/history - persisted customer AI assistant messages
chatRouter.get('/customer/history', requireAuth, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'customer') {
    return res.status(403).json({ error: 'Customer chat only' })
  }

  try {
    const rows = await getChatRows(req.user!.id, 'customer')
    return res.json({
      messages: toDisplayMessages(rows),
      history: toModelHistory(rows),
    })
  } catch (err) {
    console.error('[CustomerChatHistory] Failed to load history:', err)
    return res.status(500).json({ error: 'Failed to load chat history' })
  }
})

// DELETE /api/v1/chat/customer/history - clear persisted customer AI assistant messages
chatRouter.delete('/customer/history', requireAuth, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'customer') {
    return res.status(403).json({ error: 'Customer chat only' })
  }

  try {
    await clearChatHistory(req.user!.id, 'customer')
    return res.json({ success: true, messages: [], history: [] })
  } catch (err) {
    console.error('[CustomerChatHistory] Failed to clear history:', err)
    return res.status(500).json({ error: 'Failed to clear chat history' })
  }
})

// POST /api/v1/chat/customer - customer AI assistant (scoped to the customer's own data)
chatRouter.post('/customer', requireAuth, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'customer') {
    return res.status(403).json({ error: 'هذه الخدمة متاحة للعملاء فقط' })
  }

  const { message } = req.body

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'الرسالة مطلوبة' })
  }

  try {
    const trimmedHistory = await getModelHistory(req.user!.id, 'customer', 10)
    const result = await processCustomerChat(
      message.trim(),
      req.user!.id,
      req.user!.center_id,
      trimmedHistory,
    )
    await appendChatExchange({
      profileId: req.user!.id,
      centerId: req.user!.center_id,
      context: 'customer',
      userMessage: message.trim(),
      assistantMessage: result.reply,
    })
    const rows = await getChatRows(req.user!.id, 'customer')
    return res.json({
      ...result,
      messages: toDisplayMessages(rows),
      history: toModelHistory(rows),
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
