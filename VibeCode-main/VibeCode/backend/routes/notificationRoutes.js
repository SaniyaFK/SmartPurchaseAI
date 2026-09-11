const NotificationService = require('../services/notificationService');
const { requireAuth } = require('../middleware/authMiddleware');

/**
 * Notification API Routes — all endpoints require authentication and are
 * strictly scoped to the authenticated user (Task 3 data isolation).
 */
async function handleNotificationRoutes(req, res, pathName, method) {
  // 1. LIST: GET /api/notifications
  if (pathName === '/api/notifications' && method === 'GET') {
    return new Promise((resolve) => {
      requireAuth(req, res, async () => {
        try {
          const notifications = await NotificationService.listNotifications(req.user.id);
          const unreadCount = await NotificationService.getUnreadCount(req.user.id);
          res.status(200).json({
            success: true,
            count: notifications.length,
            unreadCount,
            data: notifications
          });
        } catch (err) {
          res.status(500).json({ success: false, message: 'Failed to load notifications.' });
        }
        resolve();
      });
    });
  }

  // 2. UNREAD COUNT: GET /api/notifications/unread-count
  if (pathName === '/api/notifications/unread-count' && method === 'GET') {
    return new Promise((resolve) => {
      requireAuth(req, res, async () => {
        try {
          const unreadCount = await NotificationService.getUnreadCount(req.user.id);
          res.status(200).json({ success: true, unreadCount, data: { unreadCount } });
        } catch (err) {
          res.status(500).json({ success: false, message: 'Failed to load unread count.' });
        }
        resolve();
      });
    });
  }

  // 3. SEED: POST /api/notifications/seed
  //    Generates notifications from live purchase deadlines & warranty alerts
  if (pathName === '/api/notifications/seed' && method === 'POST') {
    return new Promise((resolve) => {
      requireAuth(req, res, async () => {
        try {
          const created = await NotificationService.seedFromPurchases(req.user.id);
          res.status(200).json({
            success: true,
            message: 'Notifications refreshed from live purchase data.',
            count: created.length,
            data: created
          });
        } catch (err) {
          res.status(500).json({ success: false, message: 'Failed to refresh notifications.' });
        }
        resolve();
      });
    });
  }

  // 4. MARK ONE READ: POST /api/notifications/:id/read
  const markMatch = pathName.match(/^\/api\/notifications\/([a-zA-Z0-9_-]+)\/read$/);
  if (markMatch && method === 'POST') {
    const notificationId = markMatch[1];
    return new Promise((resolve) => {
      requireAuth(req, res, async () => {
        try {
          const updated = await NotificationService.markAsRead(req.user.id, notificationId);
          if (!updated) {
            return res.status(404).json({ success: false, message: 'Notification not found.' });
          }
          res.status(200).json({
            success: true,
            message: 'Notification marked as read.',
            data: updated
          });
        } catch (err) {
          res.status(500).json({ success: false, message: 'Failed to update notification.' });
        }
        resolve();
      });
    });
  }

  // 5. MARK ALL READ: POST /api/notifications/read-all
  if (pathName === '/api/notifications/read-all' && method === 'POST') {
    return new Promise((resolve) => {
      requireAuth(req, res, async () => {
        try {
          const modified = await NotificationService.markAllAsRead(req.user.id);
          res.status(200).json({
            success: true,
            message: 'All notifications marked as read.',
            modifiedCount: modified
          });
        } catch (err) {
          res.status(500).json({ success: false, message: 'Failed to update notifications.' });
        }
        resolve();
      });
    });
  }

  return false; // Route not handled
}

module.exports = { handleNotificationRoutes };
