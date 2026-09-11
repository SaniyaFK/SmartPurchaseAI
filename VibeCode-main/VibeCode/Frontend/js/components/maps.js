/**
 * Reusable Google Maps Component Wrapper — VibeCode Starter Architecture
 * Supports container initialization, dynamic markers, and safe fallback error handling.
 */
class GoogleMapsService {
  constructor(apiKey = '') {
    this.apiKey = apiKey || window.GOOGLE_MAPS_API_KEY || '';
    this.isLoaded = false;
  }

  loadScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps) {
        this.isLoaded = true;
        return resolve(window.google.maps);
      }

      if (!this.apiKey) {
        return reject(new Error('Google Maps API key is not configured. Set GOOGLE_MAPS_API_KEY in your environment variables.'));
      }

      const scriptId = 'google-maps-script';
      if (document.getElementById(scriptId)) {
        return resolve(window.google.maps);
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${this.apiKey}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        this.isLoaded = true;
        resolve(window.google.maps);
      };
      script.onerror = () => reject(new Error('Failed to load Google Maps script. Check API key validity or network connection.'));
      document.head.appendChild(script);
    });
  }

  async initMap(elementId, center = { lat: 37.7749, lng: -122.4194 }, zoom = 12) {
    const el = document.getElementById(elementId);
    if (!el) return null;

    try {
      const maps = await this.loadScript();
      const map = new maps.Map(el, { center, zoom });
      return map;
    } catch (err) {
      el.innerHTML = `
        <div style="padding: 24px; text-align: center; border: 1px dashed rgba(255,255,255,0.2); border-radius: 12px; color: #a1a1aa; font-family: sans-serif;">
          <i class="fa-solid fa-location-dot" style="font-size: 2rem; color: #6366f1; margin-bottom: 12px;"></i>
          <p style="margin: 0; font-weight: 500;">Google Maps Component Placeholder</p>
          <small style="opacity: 0.7;">${err.message}</small>
        </div>
      `;
      return null;
    }
  }
}

window.GoogleMapsService = GoogleMapsService;
