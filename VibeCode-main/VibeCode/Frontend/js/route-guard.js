/**
 * Client-side Route Guard & Authentication State Manager — VibeCode Starter
 * Enforces route authorization, session verification, and auto-populates user profiles across pages.
 */
class RouteGuard {
  /**
   * Verify if current session is authenticated
   */
  static async checkAuth() {
    let user = null;

    try {
      if (window.ApiService) {
        const response = await ApiService.get('/auth/me');
        if (response && response.success && response.data && response.data.user) {
          user = response.data.user;
          localStorage.setItem('userSession', JSON.stringify({ ...user, isLoggedIn: true }));
        }
      }
    } catch (err) {
      // Backend auth check failed
    }

    if (!user) {
      // Fallback local session check
      const localSession = localStorage.getItem('userSession');
      if (localSession) {
        try {
          const parsed = JSON.parse(localSession);
          if (parsed && parsed.isLoggedIn) user = parsed;
        } catch (e) {
          localStorage.removeItem('userSession');
        }
      }
    }

    RouteGuard.updateDOMProfile(user);
    return user;
  }

  /**
   * Automatically update profile elements across all HTML pages
   */
  static updateDOMProfile(user) {
    if (!user) return;

    const displayName = user.name || (user.email ? user.email.split('@')[0] : 'User');
    const displayEmail = user.email || '';
    const displayRole = (user.role || 'user').toUpperCase();

    // Update names across headers, menus, greetings, sidebars
    const nameEls = document.querySelectorAll('#userName, .user-name, .user-profile-name, #userNameDisplay, #greetingUserName, #menuUserName, #profileName, #profileFullName, #heroUserName');
    nameEls.forEach(el => {
      el.textContent = displayName;
    });

    // Update emails across headers, dropdown menus, profile views
    const emailEls = document.querySelectorAll('#userEmail, #menuUserEmail, #profileEmail, .user-email, #userEmailDisplay, .profile-header-email');
    emailEls.forEach(el => {
      el.textContent = displayEmail;
    });

    // Update roles and badges
    const roleEls = document.querySelectorAll('#userRole, .user-role, #userRoleDisplay, #menuRoleBadge, #profileRoleBadge');
    roleEls.forEach(el => {
      el.textContent = displayRole;
    });

    // Update avatar initials if available
    const initialEls = document.querySelectorAll('#profileAvatarInitials, .avatar-initials');
    initialEls.forEach(el => {
      el.textContent = displayName.charAt(0).toUpperCase();
    });
  }

  /**
   * Enforce authentication for protected pages (e.g. dashboard.html)
   */
  static async requireAuth(redirectTo = './index.html') {
    const user = await RouteGuard.checkAuth();
    if (!user) {
      window.location.href = redirectTo;
      return null;
    }
    return user;
  }

  /**
   * Enforce guest status for login/register pages (e.g. index.html)
   */
  static async requireGuest(redirectTo = './dashboard.html') {
    const user = await RouteGuard.checkAuth();
    if (user) {
      window.location.href = redirectTo;
      return user;
    }
    return null;
  }

  /**
   * Logout user and clear all authentication tokens/cookies
   */
  static async logout(redirectTo = './index.html') {
    try {
      if (window.ApiService) {
        await ApiService.post('/auth/logout');
      }
    } catch (e) {
      console.warn('Backend logout call completed with warning:', e.message);
    } finally {
      // Clear all user-specific localStorage keys
      localStorage.removeItem('userSession');
      localStorage.removeItem('vibecode_token');
      localStorage.removeItem('currency'); // per-user preference — reset for next login
      sessionStorage.clear();
      window.location.href = redirectTo;
    }
  }
}

// Auto-run profile check on page load
document.addEventListener('DOMContentLoaded', () => {
  RouteGuard.checkAuth();
});

window.RouteGuard = RouteGuard;
