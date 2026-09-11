const ClaimService = require('../services/claimService');
const { requireAuth } = require('../middleware/authMiddleware');

/**
 * AI Warranty Claim API Routes — Task 6.
 * Every endpoint requires authentication and is strictly scoped to the
 * authenticated user (Task 3 data isolation).
 */
async function handleClaimRoutes(req, res, pathName, method) {
  const isClaimRoute =
    pathName === '/api/claims' ||
    !!pathName.match(/^\/api\/claims\/[a-zA-Z0-9_-]+$/);

  if (!isClaimRoute) {
    return false; // Not a claims route — let other handlers try
  }

  return new Promise((resolve) => {
    requireAuth(req, res, async () => {
      const userId = req.user.id;

      // 1. LIST: GET /api/claims
      if (pathName === '/api/claims' && method === 'GET') {
        try {
          const claims = await ClaimService.listClaims(userId);
          return res.status(200).json({
            success: true,
            count: claims.length,
            data: claims
          });
        } catch (err) {
          return res.status(500).json({ success: false, message: 'Failed to load claims.' });
        }
      }

      // 2. CREATE: POST /api/claims
      if (pathName === '/api/claims' && method === 'POST') {
        const { purchaseId, issueCategory, issueDescription, desiredResolution, customerName, customerEmail } = req.body;
        if (!purchaseId) {
          return res.status(400).json({ success: false, message: 'purchaseId is required to file a claim.' });
        }

        try {
          const claim = await ClaimService.createClaim(userId, {
            purchaseId,
            issueCategory,
            issueDescription,
            desiredResolution,
            customerName: customerName || req.user?.name,
            customerEmail: customerEmail || req.user?.email
          });
          return res.status(201).json({
            success: true,
            message: 'AI Warranty Claim filed and saved to MongoDB successfully!',
            data: claim
          });
        } catch (err) {
          const statusCode = err.statusCode || 500;
          const message = statusCode === 404 ? err.message : 'Failed to file the claim.';
          return res.status(statusCode).json({ success: false, message });
        }
      }

      // 3. Single claim: GET / PATCH / DELETE
      const claimMatch = pathName.match(/^\/api\/claims\/([a-zA-Z0-9_-]+)$/);
      if (claimMatch) {
        const claimId = claimMatch[1];

        if (method === 'GET') {
          try {
            const claim = await ClaimService.getClaimById(userId, claimId);
            if (!claim) {
              return res.status(404).json({ success: false, message: 'Claim not found.' });
            }
            return res.status(200).json({ success: true, data: claim });
          } catch (err) {
            return res.status(500).json({ success: false, message: 'Failed to load claim.' });
          }
        }

        if (method === 'PUT' || method === 'PATCH') {
          try {
            const updated = await ClaimService.updateClaimStatus(userId, claimId, req.body.status, req.body.resolutionNote);
            if (!updated) {
              return res.status(404).json({ success: false, message: 'Claim not found.' });
            }
            return res.status(200).json({
              success: true,
              message: `Claim status updated to "${updated.status}".`,
              data: updated
            });
          } catch (err) {
            const statusCode = err.statusCode || 500;
            return res.status(statusCode).json({ success: false, message: err.message || 'Failed to update claim.' });
          }
        }

        if (method === 'DELETE') {
          try {
            const deleted = await ClaimService.deleteClaim(userId, claimId);
            if (!deleted) {
              return res.status(404).json({ success: false, message: 'Claim not found or already deleted.' });
            }
            return res.status(200).json({ success: true, message: 'Claim record removed successfully.' });
          } catch (err) {
            return res.status(500).json({ success: false, message: 'Failed to delete claim.' });
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

module.exports = { handleClaimRoutes };
