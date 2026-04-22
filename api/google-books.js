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

    async function callGoogle(q) {
      const url =
        "https://www.googleapis.com/books/v1/volumes" +
        `?q=${encodeURIComponent(q)}` +
        "&maxResults=1" +
        `&key=${encodeURIComponent(apiKey)}`;

      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, json: j, url };
    }

    // 1) try strict isbn query
    let r1 = await callGoogle(`isbn:${isbn}`);

    // If debug, always return what Google said (first call)
    if (debug) {
      return res.status(200).json({
        debug: true,
        tried: [`isbn:${isbn}`],
        googleStatus: r1.status,
        googleUrl: r1.url,
        googleJson: r1.json
      });
    }

    // If Google returned an error (403/400/etc), surface it
    if (!r1.ok) {
      return res.status(502).json({
        error: "Google Books returned an error",
        googleStatus: r1.status,
        details: r1.json
      });
    }

    // If no items, try fallback query (plain number)
    if (!r1.json.items || !r1.json.items.length) {
      const r2 = await callGoogle(isbn);

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

      r1 = r2;
    }

    const info = (r1.json.items[0] && r1.json.items[0].volumeInfo) ? r1.json.items[0].volumeInfo : {};
    const authors = Array.isArray(info.authors) ? info.authors.join(", ") : "";

    let coverUrl = "";
    if (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) {
      coverUrl = (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail).replace(/^http:\/\//i, "https://");
    }

    return res.status(200).json({
      found: true,
      title: info.title || "",
      author: authors,
      language: info.language || "",
      coverUrl
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
};
``
