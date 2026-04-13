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

  try {
    const result = await processChat(message.trim(), centerId, history || [])
    return res.json(result)
  } catch (err) {
    console.error('[Chat] Error:', err)
    return res.status(500).json({
      error: 'فشل معالجة الرسالة',
      reply: 'عذراً، حصلت مشكلة. حاول تاني.',
    })
  }
})
