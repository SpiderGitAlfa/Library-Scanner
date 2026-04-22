module.exports = async (req, res) => {
  try {
    const isbn = String(req.query.isbn || "")
      .replace(/[^0-9Xx]/g, "")
      .toUpperCase();

    const debug = String(req.query.debug || "") === "1";

    if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
      return res.status(400).json({ error: "Invalid ISBN" });
    }

    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GOOGLE_BOOKS_API_KEY" });
    }

    // --- helpers ---
    function sleep(ms) {
      return new Promise(r => setTimeout(r, ms));
    }

    // Evita di stampare o ritornare la key nei debug
    function maskKeyInUrl(url) {
      return url.replace(/([?&]key=)[^&]+/i, "$1***");
    }

    // Google Books Volumes list endpoint: q = search terms (supports isbn:...) [4](https://stackoverflow.com/questions/57643225/not-getting-book-data-from-openlibrary-org-api)[5](https://support.google.com/appsheet/answer/11617175?hl=en)
    function buildUrl(q) {
      return (
        "https://www.googleapis.com/books/v1/volumes" +
        `?q=${encodeURIComponent(q)}` +
        "&maxResults=1" +
        `&key=${encodeURIComponent(apiKey)}`
      );
    }

    // Retry policy: retry on transient errors: 408, 429, 5xx [3](https://bing.com/search?q=Google+Apps+Script+simple+trigger+onEdit+limitations+installable+trigger+SpreadsheetApp)
    async function fetchWithRetry(url) {
      const delays = [500, 1000, 2000]; // ms
      let last = null;

      for (let i = 0; i < delays.length; i++) {
        const r = await fetch(url);
        const j = await r.json().catch(() => ({}));

        last = { ok: r.ok, status: r.status, json: j, url };

        if (r.ok) return last;

        const retryable =
          r.status === 408 ||
          r.status === 429 ||
          (r.status >= 500 && r.status < 600);

        // 4xx (tranne 429) → non retry
        if (!retryable) return last;

        // backoff + jitter
        const jitter = Math.floor(Math.random() * 200);
        await sleep(delays[i] + jitter);
      }

      // dopo i tentativi: restituiamo ultimo errore
      return last || { ok: false, status: 503, json: { error: { code: 503, message: "Service unavailable" } }, url };
    }

    // Parse Google Books Volume schema: imageLinks contains thumbnails when available [6](https://play.google.com/store/apps/details?id=com.sheets.barcode_scanner&hl=en)[7](https://spreadsheetpoint.com/keep-leading-zeros-in-google-sheets/)
    function mapVolumeToResult(items) {
      const v = (items && items[0] && items[0].volumeInfo) ? items[0].volumeInfo : {};
      const authors = Array.isArray(v.authors) ? v.authors.join(", ") : "";

      let coverUrl = "";
      if (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) {
        coverUrl = (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail).replace(/^http:\/\//i, "https://");
      }

      return {
        found: true,
        title: v.title || "",
        author: authors,
        publisher: v.publisher || "",
        description: v.description || "",
        language: v.language || "",
        coverUrl
      };
    }

    // ---- 1) Try strict query: isbn:xxxx ----
    const tried = [];
    const url1 = buildUrl(`isbn:${isbn}`);
    tried.push(`isbn:${isbn}`);

    const r1 = await fetchWithRetry(url1);

    // DEBUG (senza key)
    if (debug) {
      return res.status(200).json({
        debug: true,
        tried,
        googleStatus: r1.status,
        googleUrl: maskKeyInUrl(r1.url),
        googleJson: r1.json
      });
    }

    // Se Google risponde con errore temporaneo (es. 503 backendFailed), rispondiamo "temporary"
    // 503 significa servizio temporaneamente non disponibile. [1](https://support.google.com/docs/thread/123114346/how-do-i-remove-a-leading-apostrophe-from-in-front-of-a-bunch-of-text-cells?hl=en)[2](https://www.labnol.org/code/20020-query-book-by-isbn)
    if (!r1.ok && (r1.status === 503 || (r1.status >= 500 && r1.status < 600))) {
      return res.status(200).json({
        found: false,
        temporary: true,
        message: "Google Books temporaneamente non disponibile. Riprova tra 1-2 minuti."
      });
    }

    // Errori non temporanei (es. 400/403) → ritorniamo errore leggibile
    if (!r1.ok) {
      return res.status(502).json({
        error: "Google Books returned an error",
        googleStatus: r1.status,
        details: r1.json
      });
    }

    // ---- 2) If no items, try fallback query: plain number ----
    if (!r1.json.items || !r1.json.items.length) {
      const url2 = buildUrl(isbn);
      tried.push(isbn);

      const r2 = await fetchWithRetry(url2);

      if (!r2.ok && (r2.status === 503 || (r2.status >= 500 && r2.status < 600))) {
        return res.status(200).json({
          found: false,
          temporary: true,
          message: "Google Books temporaneamente non disponibile. Riprova tra 1-2 minuti."
        });
      }

      if (!r2.ok) {
        return res.status(502).json({
          error: "Google Books returned an error (fallback)",
          googleStatus: r2.status,
          details: r2.json
        });
      }

      if (!r2.json.items || !r2.json.items.length) {
        return res.status(200).json({ found: false });
      }

      return res.status(200).json(mapVolumeToResult(r2.json.items));
    }

    // Success: items found from isbn: query
    return res.status(200).json(mapVolumeToResult(r1.json.items));
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
};
``
