// auditors/http.js
// Thin Axios wrapper shared by the crawl-based auditors. Centralizes the user-agent,
// timeout, and redirect handling so every module fetches pages the same way, and so a
// network failure degrades into a structured result instead of an unhandled throw.

import axios from 'axios';

const DEFAULT_TIMEOUT_MS = 15000;

// Identify as a normal browser. We're auditing static (non-JS) HTML deliberately —
// that's exactly what an AI crawler sees — so we do NOT execute JavaScript.
const USER_AGENT =
  'Mozilla/5.0 (compatible; SlingAIAuditBot/1.0; +https://sling.com) AppleWebKit/537.36';

export async function fetchUrl(url, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const res = await axios.get(url, {
      timeout,
      maxRedirects: 5,
      // Treat any HTTP status as "resolved" so callers can inspect 404/403 themselves.
      validateStatus: () => true,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      url,
      finalUrl: res.request?.res?.responseUrl || url,
      contentType: res.headers['content-type'] || '',
      body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url,
      finalUrl: url,
      contentType: '',
      body: '',
      error: err.code || err.message || 'request failed',
    };
  }
}
