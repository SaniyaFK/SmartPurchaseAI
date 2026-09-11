/**
 * ragRoutes.js — Hybrid RAG Chatbot API
 *
 * Endpoint: POST /api/chat
 *
 * Security:
 *   • JWT authentication via requireAuth middleware.
 *   • userId is ALWAYS taken from req.user.id (server-decoded JWT).
 *   • The body's userId field (if any) is explicitly ignored.
 *
 * Also exposes:
 *   GET  /api/chat/sessions          — list RAG chat sessions (via ChatHistory)
 *   GET  /api/chat/sessions/:id      — get session messages
 *   DELETE /api/chat/sessions/:id    — clear a session
 *   POST /api/chat/rebuild           — force re-index all purchases for current user
 */

const mongoose = require('mongoose');
const ChatHistory = require('../models/ChatHistory');
const { requireAuth } = require('../middleware/authMiddleware');
const { generateAnswer } = require('../services/ragService');
const { rebuildUserIndex } = require('../services/ragIndexService');

// ─── In-memory chat session fallback (mirrors CopilotService) ─────────────────
const inMemoryRagChats = new Map();
let memSeq = 0;

function newSessionId() {
  memSeq += 1;
  return `rag_${Date.now()}_${memSeq}_${Math.random().toString(36).substr(2, 5)}`;
}

function toSerializable(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = obj._id && obj._id.toString ? obj._id.toString() : obj._id;
  return obj;
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

async function handleRagRoutes(req, res, pathName, method) {
  // Only handle /api/chat routes
  const isRagRoute =
    pathName === '/api/chat' ||
    pathName === '/api/chat/rebuild' ||
    pathName === '/api/chat/sessions' ||
    !!pathName.match(/^\/api\/chat\/sessions\/[a-zA-Z0-9_-]+$/);

  if (!isRagRoute) {
    return false; // Pass to next handler
  }

  return new Promise(resolve => {
    requireAuth(req, res, async () => {
      // userId ALWAYS from JWT — never from req.body
      const userId = req.user.id;

      // ── POST /api/chat ────────────────────────────────────────────────────
      if (pathName === '/api/chat' && method === 'POST') {
        const { message, sessionId: reqSessionId } = req.body;
        if (!message || !String(message).trim()) {
          return res.status(400).json({
            success: false,
            message: 'message is required.'
          });
        }

        try {
          const query = String(message).trim();

          // Core RAG pipeline (userId-scoped retrieval + Gemini generation)
          const { answer, sources } = await generateAnswer(userId, query);

          // ── Persist to ChatHistory ──────────────────────────────────────
          let currentSessionId = reqSessionId || null;

          if (mongoose.connection.readyState === 1) {
            try {
              let session = currentSessionId
                ? await ChatHistory.findOne({ sessionId: currentSessionId, userId })
                : null;

              if (!session) {
                session = new ChatHistory({
                  userId,
                  sessionId: newSessionId(),
                  title: `AI Chat ${new Date().toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                  })}`,
                  messages: []
                });
                currentSessionId = session.sessionId;
              }

              session.messages.push(
                { role: 'user', content: query, timestamp: new Date() },
                { role: 'assistant', content: answer, timestamp: new Date() }
              );
              // Keep last 100 messages per session
              if (session.messages.length > 100) {
                session.messages = session.messages.slice(-100);
              }
              session.lastActive = new Date();
              await session.save();
            } catch (err) {
              console.warn('[RAG] ChatHistory save warning:', err.message);
            }
          }

          // In-memory fallback session persistence
          if (!currentSessionId) currentSessionId = newSessionId();
          const existing = inMemoryRagChats.get(currentSessionId);
          if (existing) {
            existing.messages.push(
              { role: 'user', content: query, timestamp: new Date() },
              { role: 'assistant', content: answer, timestamp: new Date() }
            );
            existing.lastActive = new Date();
          } else {
            inMemoryRagChats.set(currentSessionId, {
              id: currentSessionId,
              sessionId: currentSessionId,
              userId,
              title: `AI Chat ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
              messages: [
                { role: 'user', content: query, timestamp: new Date() },
                { role: 'assistant', content: answer, timestamp: new Date() }
              ],
              lastActive: new Date(),
              createdAt: new Date()
            });
          }

          return res.status(200).json({
            success: true,
            answer,
            sources,
            sessionId: currentSessionId
          });
        } catch (err) {
          console.error('[RAG] /api/chat error:', err);
          return res.status(500).json({
            success: false,
            message: 'RAG chatbot failed to respond. Please try again.'
          });
        }
      }

      // ── POST /api/chat/rebuild ────────────────────────────────────────────
      if (pathName === '/api/chat/rebuild' && method === 'POST') {
        try {
          await rebuildUserIndex(userId);
          return res.status(200).json({
            success: true,
            message: 'RAG index rebuilt successfully for your account.'
          });
        } catch (err) {
          return res.status(500).json({
            success: false,
            message: 'Failed to rebuild RAG index.'
          });
        }
      }

      // ── GET /api/chat/sessions ────────────────────────────────────────────
      if (pathName === '/api/chat/sessions' && method === 'GET') {
        try {
          let sessions = [];
          if (mongoose.connection.readyState === 1) {
            const docs = await ChatHistory.find({ userId }).sort({ lastActive: -1 });
            sessions = docs.map(d => {
              const obj = toSerializable(d);
              obj.messageCount = (obj.messages || []).length;
              return obj;
            });
          } else {
            sessions = Array.from(inMemoryRagChats.values())
              .filter(c => c.userId === userId)
              .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
              .map(c => ({ ...c, messageCount: (c.messages || []).length }));
          }
          return res.status(200).json({ success: true, count: sessions.length, data: sessions });
        } catch (err) {
          return res.status(500).json({ success: false, message: 'Failed to load chat sessions.' });
        }
      }

      // ── Session-specific routes ───────────────────────────────────────────
      const sessionMatch = pathName.match(/^\/api\/chat\/sessions\/([a-zA-Z0-9_-]+)$/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];

        // GET /api/chat/sessions/:id
        if (method === 'GET') {
          try {
            let session = null;
            if (mongoose.connection.readyState === 1) {
              const doc = await ChatHistory.findOne({ sessionId, userId });
              if (doc) session = toSerializable(doc);
            }
            if (!session) {
              const mem = inMemoryRagChats.get(sessionId);
              if (mem && mem.userId === userId) session = mem;
            }
            if (!session) {
              return res.status(404).json({ success: false, message: 'Session not found.' });
            }
            return res.status(200).json({ success: true, data: session });
          } catch (err) {
            return res.status(500).json({ success: false, message: 'Failed to load session.' });
          }
        }

        // DELETE /api/chat/sessions/:id
        if (method === 'DELETE') {
          try {
            let deleted = false;
            if (mongoose.connection.readyState === 1) {
              const result = await ChatHistory.deleteOne({ sessionId, userId });
              deleted = result.deletedCount > 0;
            }
            const mem = inMemoryRagChats.get(sessionId);
            if (mem && mem.userId === userId) {
              inMemoryRagChats.delete(sessionId);
              deleted = true;
            }
            if (!deleted) {
              return res.status(404).json({ success: false, message: 'Session not found.' });
            }
            return res.status(200).json({ success: true, message: 'Session cleared.' });
          } catch (err) {
            return res.status(500).json({ success: false, message: 'Failed to clear session.' });
          }
        }
      }

      // Unknown sub-route
      return res.status(404).json({
        success: false,
        message: `API Endpoint ${method} ${pathName} not found.`
      });
    });
  });
}

module.exports = { handleRagRoutes };
