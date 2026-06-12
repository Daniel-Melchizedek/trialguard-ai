const cheerio = require("cheerio");

const MIN_USEFUL_LENGTH = 100;
const MAX_CONTEXT_LENGTH = 1500;

// The extension stores websiteUrl as a bare hostname (e.g. "app.azurewebsites.net").
// Without a scheme, fetch() throws, so we'd never retrieve the real page content —
// leaving the tip agent with no grounding. Ensure an absolute https:// URL.
function toAbsoluteUrl(url) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

async function fetchProductContext(websiteUrl, productName) {
  // Step 1: direct fetch of the trial's website URL
  const target = toAbsoluteUrl(websiteUrl);
  if (target) {
    try {
      const res = await fetch(target, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TrialGuard/1.0)" }
      });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        $("script, style, nav, footer, header, aside").remove();
        const text = $("body").text().replace(/\s+/g, " ").trim();
        if (text.length >= MIN_USEFUL_LENGTH) {
          return text.slice(0, MAX_CONTEXT_LENGTH);
        }
      }
    } catch (_) { /* fall through to Bing */ }
  }

  // Step 2: Bing Search fallback — finds tutorials, docs, feature pages
  if (process.env.BING_SEARCH_KEY) {
    try {
      const q = encodeURIComponent(`${productName} features tips getting started tutorial`);
      const res = await fetch(
        `https://api.bing.microsoft.com/v7.0/search?q=${q}&count=3&responseFilter=Webpages`,
        {
          headers: { "Ocp-Apim-Subscription-Key": process.env.BING_SEARCH_KEY },
          signal: AbortSignal.timeout(5000)
        }
      );
      if (res.ok) {
        const data = await res.json();
        const snippets = (data.webPages?.value || []).map(r => r.snippet).join(" ").trim();
        if (snippets.length >= MIN_USEFUL_LENGTH) {
          return snippets.slice(0, MAX_CONTEXT_LENGTH);
        }
      }
    } catch (_) { /* fall through — model uses own knowledge */ }
  }

  return null;
}

module.exports = { fetchProductContext };
