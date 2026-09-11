const CopilotService = require('../services/copilotService');
const { requireAuth } = require('../middleware/authMiddleware');

/**
 * AI Purchase Copilot API Routes — Task 7.
 * Chat endpoint answers from the user's real MongoDB data and persists
 * conversations to the ChatHistory collection.
 */
async function handleCopilotRoutes(req, res, pathName, method) {
  const isCopilotRoute =
    pathName === '/api/copilot/chat' ||
    pathName === '/api/copilot/suggestions' ||
    pathName === '/api/copilot/history' ||
    !!pathName.match(/^\/api\/copilot\/history\/[a-zA-Z0-9_-]+$/);

  if (!isCopilotRoute) {
    return false; // Not a copilot route — let other handlers try
  }

  return new Promise((resolve) => {
    requireAuth(req, res, async () => {
      const userId = req.user.id;

      // 1. CHAT: POST /api/copilot/chat
      if (pathName === '/api/copilot/chat' && method === 'POST') {
        const { message, sessionId } = req.body;
        if (!message || !String(message).trim()) {
          return res.status(400).json({ success: false, message: 'message is required.' });
        }
        try {
          const result = await CopilotService.chat(userId, String(message).trim(), sessionId || null);
          return res.status(200).json({
            success: true,
            message: 'Copilot responded from your live vault data.',
            data: result
          });
        } catch (err) {
          return res.status(500).json({ success: false, message: 'Copilot failed to respond. Please try again.' });
        }
      }

      // 2. SUGGESTIONS: GET /api/copilot/suggestions
      //    Data-driven suggestions + vault summary for the chatbot welcome
      if (pathName === '/api/copilot/suggestions' && method === 'GET') {
        try {
          const data = await CopilotService.getSuggestions(userId);
          return res.status(200).json({
            success: true,
            message: 'Copilot suggestions generated from your live vault data.',
            data
          });
        } catch (err) {
          return res.status(500).json({ success: false, message: 'Failed to generate suggestions.' });
        }
      }

      // 3. SESSIONS: GET /api/copilot/history
      if (pathName === '/api/copilot/history' && method === 'GET') {
        try {
          const sessions = await CopilotService.getSessions(userId);
          return res.status(200).json({
            success: true,
            count: sessions.length,
            data: sessions
          });
        } catch (err) {
          return res.status(500).json({ success: false, message: 'Failed to load chat history.' });
        }
      }

      // 4. SESSION MESSAGES: GET /api/copilot/history/:sessionId
      const historyMatch = pathName.match(/^\/api\/copilot\/history\/([a-zA-Z0-9_-]+)$/);
      if (historyMatch) {
        const sessionId = historyMatch[1];

        if (method === 'GET') {
          try {
            const session = await CopilotService.getSessionMessages(userId, sessionId);
            if (!session) {
              return res.status(404).json({ success: false, message: 'Chat session not found.' });
            }
            return res.status(200).json({ success: true, data: session });
          } catch (err) {
            return res.status(500).json({ success: false, message: 'Failed to load chat session.' });
          }
        }

        if (method === 'DELETE') {
          try {
            const deleted = await CopilotService.clearSession(userId, sessionId);
            if (!deleted) {
              return res.status(404).json({ success: false, message: 'Chat session not found.' });
            }
            return res.status(200).json({ success: true, message: 'Chat session cleared.' });
          } catch (err) {
            return res.status(500).json({ success: false, message: 'Failed to clear chat session.' });
          }
        }
      }

      return res.status(404).json({
        success: false,
        message: `API Endpoint ${method} ${pathName} not found.`
      });
    });
  });
}

module.exports = { handleCopilotRoutes };
