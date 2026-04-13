import { Router, Response } from 'express'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'
import { processChat } from '../services/chat'

export const chatRouter = Router()

// POST /api/v1/chat — send a message to the AI assistant
chatRouter.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id
  if (!centerId) {
    return res.status(400).json({ error: 'لا يوجد مركز مرتبط بهذا الحساب' })
  }

  const { message, history } = req.body

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'الرسالة مطلوبة' })
  }

  // Only keep last 10 messages in history to avoid token limits
  const trimmedHistory = Array.isArray(history) ? history.slice(-10) : []

  try {
    const result = await processChat(message.trim(), centerId, trimmedHistory)
    return res.json(result)
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Chat] Error:', errMsg)
    return res.status(500).json({
      error: 'فشل معالجة الرسالة',
      reply: `عذراً، حصلت مشكلة: ${errMsg}`,
    })
  }
})
