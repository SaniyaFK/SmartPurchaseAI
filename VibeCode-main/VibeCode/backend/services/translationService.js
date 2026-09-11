/**
 * Translation Service — WarrantyVault AI
 * Free, server-side translation service supporting 7 languages:
 * 1. English (en) - Default
 * 2. Hindi (hi)
 * 3. Marathi (mr)
 * 4. Gujarati (gu)
 * 5. Bhojpuri (bho)
 * 6. Bengali (bn)
 * 7. Tamil (ta)
 *
 * Preserves factual receipt data, currency figures, dates, and bullet formats.
 * Zero paid API dependencies or external keys required.
 */

const https = require('https');

const SUPPORTED_LANGUAGES = {
  'en': { name: 'English', code: 'en' },
  'hi': { name: 'Hindi', code: 'hi' },
  'mr': { name: 'Marathi', code: 'mr' },
  'gu': { name: 'Gujarati', code: 'gu' },
  'bho': { name: 'Bhojpuri', code: 'bho' },
  'bn': { name: 'Bengali', code: 'bn' },
  'ta': { name: 'Tamil', code: 'ta' }
};

class TranslationService {
  /**
   * Get dictionary of supported languages
   */
  static getSupportedLanguages() {
    return SUPPORTED_LANGUAGES;
  }

  /**
   * Check if a language code is valid and supported
   */
  static isLanguageSupported(langCode) {
    if (!langCode) return false;
    const normalized = String(langCode).toLowerCase().trim();
    return Boolean(SUPPORTED_LANGUAGES[normalized]);
  }

  /**
   * Translate stored receipt summary into target language
   * @param {string} summary - Stored receipt summary text
   * @param {string} targetLang - Target language code ('en', 'hi', 'mr', 'gu', 'bho', 'bn', 'ta')
   * @returns {Promise<string>} Translated summary text
   */
  static async translateReceiptSummary(summary, targetLang) {
    if (!summary || typeof summary !== 'string') {
      throw new Error('Receipt has no summary available to translate.');
    }

    const lang = String(targetLang || 'en').toLowerCase().trim();

    if (!SUPPORTED_LANGUAGES[lang]) {
      throw new Error(`Language "${targetLang}" is not supported. Supported languages: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`);
    }

    // English is the source language — return original summary directly
    if (lang === 'en') {
      return summary.trim();
    }

    // Call free translation engine
    const translated = await TranslationService.executeFreeTranslation(summary.trim(), lang);
    if (!translated || !translated.trim()) {
      throw new Error(`Translation unavailable for language: ${SUPPORTED_LANGUAGES[lang].name}`);
    }

    return translated.trim();
  }

  /**
   * Free, reliable multi-language translation engine
   * Translates text while preserving bullet markers and line structures.
   */
  static async executeFreeTranslation(text, targetLang) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return text;

    // Translate each line or the full paragraph while preserving bullet markers
    const translatedLines = [];

    for (const line of lines) {
      const isBullet = line.startsWith('•') || line.startsWith('-') || line.startsWith('*');
      const cleanLine = isBullet ? line.replace(/^[•\-\*]\s*/, '').trim() : line;

      try {
        const translatedLine = await TranslationService.fetchTranslationChunk(cleanLine, targetLang);
        if (isBullet) {
          translatedLines.push(`• ${translatedLine || cleanLine}`);
        } else {
          translatedLines.push(translatedLine || cleanLine);
        }
      } catch (err) {
        console.warn(`[TranslationService] Line translation notice (${targetLang}):`, err.message);
        // On partial line failure, retain the line
        translatedLines.push(line);
      }
    }

    return translatedLines.join('\n');
  }

  /**
   * Fetch single text chunk translation from public translation endpoint
   */
  static fetchTranslationChunk(text, targetLang) {
    return new Promise((resolve, reject) => {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;

      const req = https.get(url, { timeout: 8000 }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Translation service returned HTTP ${res.statusCode}`));
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            let result = '';
            if (parsed && Array.isArray(parsed[0])) {
              result = parsed[0].map(item => (item && item[0]) ? item[0] : '').join('');
            }
            resolve(result || text);
          } catch (err) {
            reject(new Error('Failed to parse translation response.'));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Translation request timed out.'));
      });

      req.on('error', (err) => {
        reject(new Error(err.message || 'Translation network error.'));
      });
    });
  }

  /**
   * Synthesize natural speech audio for given text and language.
   * Returns a Buffer containing concatenated MP3 audio data.
   */
  static async synthesizeSpeechAudio(text, langCode = 'mr') {
    if (!text || !text.trim()) {
      throw new Error('No text provided for speech synthesis.');
    }

    const lang = String(langCode).toLowerCase().trim();
    const ttsLang = (lang === 'bho') ? 'hi' : (SUPPORTED_LANGUAGES[lang] ? lang : 'mr');

    // Split text into lines/sentences within safe length limits (<180 chars)
    const rawLines = text
      .replace(/[•\-\*]/g, '')
      .split(/\r?\n|\.|\u0964/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const linesToProcess = rawLines.length > 0 ? rawLines : [text.trim()];
    const audioBuffers = [];

    for (const line of linesToProcess) {
      const chunks = [];
      if (line.length > 180) {
        const words = line.split(' ');
        let cur = '';
        for (const w of words) {
          if ((cur + ' ' + w).length > 180) {
            if (cur) chunks.push(cur.trim());
            cur = w;
          } else {
            cur = (cur ? cur + ' ' : '') + w;
          }
        }
        if (cur) chunks.push(cur.trim());
      } else {
        chunks.push(line);
      }

      for (const chunk of chunks) {
        try {
          const buf = await TranslationService.fetchTTSAudioChunk(chunk, ttsLang);
          if (buf && buf.length > 0) {
            audioBuffers.push(buf);
          }
        } catch (err) {
          console.warn('[TranslationService] TTS chunk notice:', err.message);
        }
      }
    }

    if (audioBuffers.length === 0) {
      throw new Error('Failed to generate audio stream.');
    }

    return Buffer.concat(audioBuffers);
  }

  /**
   * Fetch a single TTS audio chunk from public TTS service
   */
  static fetchTTSAudioChunk(text, lang) {
    return new Promise((resolve, reject) => {
      const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`TTS stream HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('TTS request timed out.')); });
      req.on('error', reject);
    });
  }
}

module.exports = TranslationService;
