module.exports = async (req, res) => {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Notion-Version");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // --- Robust body parsing ---
    let body = req.body;
    if (!body) return res.status(400).json({ error: "Empty request body. Did you send JSON?" });

    if (typeof body === "string") {
      try { body = JSON.parse(body); }
      catch { return res.status(400).json({ error: "Body is not valid JSON" }); }
    }

    const { notionToken, databaseId, book } = body;

    if (!notionToken || !databaseId) {
      return res.status(400).json({ error: "Missing notionToken or databaseId" });
    }
    if (!book || !book.isbn13) {
      return res.status(400).json({ error: "Missing book or book.isbn13" });
    }

    // --- sanitize databaseId (handles URLs + ?v=...) ---
    let cleanDatabaseId = String(databaseId).trim();
    cleanDatabaseId = cleanDatabaseId.replace(/^https?:\/\/www\.notion\.so\//, "");
    cleanDatabaseId = cleanDatabaseId.split("?")[0];
    cleanDatabaseId = cleanDatabaseId.replace(/[^a-zA-Z0-9-]/g, "");

    // Legacy Notion-Version: databases.query is deprecated in newer versions. [3](https://appsheettraining.com/expression_detail/lists-extractnumbers)
    const NOTION_VERSION = "2022-06-28";

    // --- helper: sanitize URLs for Notion ---
    function sanitizeUrl(u) {
      if (!u) return "";
      return String(u)
        .replace(/&amp;/g, "&")
        .replace(/^http:\/\//i, "https://")
        .trim();
    }

    const cleanCoverUrl = sanitizeUrl(book.coverUrl);

    // --- helper: safe logging without secrets ---
    console.log("[save-book] called", {
      hasToken: !!notionToken,
      databaseIdPrefix: cleanDatabaseId.slice(0, 8) + "...",
      isbn13: String(book.isbn13)
    });

    // 1) Duplicate check (Query database) [3](https://appsheettraining.com/expression_detail/lists-extractnumbers)
    const notionQueryUrl = `https://api.notion.com/v1/databases/${cleanDatabaseId}/query`;

    const queryResp = await fetch(notionQueryUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`, // Bearer auth [4](https://support.google.com/appsheet/answer/15263206?hl=en)
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filter: {
          property: "ISBN-13",
          rich_text: { equals: String(book.isbn13) }
        },
        page_size: 1
      })
    });

    const queryText = await queryResp.text();
    console.log("NOTION QUERY STATUS:", queryResp.status);
    console.log("NOTION QUERY BODY:", queryText);

    let queryJson;
    try { queryJson = JSON.parse(queryText); } catch { queryJson = { raw: queryText }; }

    if (!queryResp.ok) {
      return res.status(queryResp.status).json({
        error: "Notion query failed",
        details: queryJson
      });
    }

    if (queryJson.results && queryJson.results.length > 0) {
      return res.status(200).json({
        status: "duplicate",
        existingPageId: queryJson.results[0].id
      });
    }

    // 2) Create page (POST /v1/pages) [2](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
    // NOTE:
    // - "Stato" must exist in Notion as Select, with option "In casa"
    // - "Posizione" must exist as Select with options matching values sent
    // - "Lingua" is written as rich_text to avoid select-option validation errors
    const properties = {
      "Titolo": { title: [{ text: { content: book.title || "Senza titolo" } }] },
      "Autore": { rich_text: [{ text: { content: book.author || "" } }] },
      "Casa Editrice": { rich_text: [{ text: { content: book.publisher || "" } }] },
      "ISBN-10": { rich_text: [{ text: { content: book.isbn10 || "" } }] },
      "ISBN-13": { rich_text: [{ text: { content: String(book.isbn13 || "") } }] },
      "ASIN": { rich_text: [{ text: { content: book.asin || "" } }] },
      "Descrizione": { rich_text: [{ text: { content: book.description || "" } }] },

      // Keep the URL property (optional but useful)
      "Copertina URL": cleanCoverUrl ? { url: cleanCoverUrl } : undefined,

      // Posizione select (must exist + option must exist)
      "Posizione": book.location ? { select: { name: book.location } } : undefined,

      // Lingua as text (robust)
      "Lingua": book.language ? { rich_text: [{ text: { content: String(book.language) } }] } : undefined,

      // Stato default (must exist + option "In casa" must exist)
      "Stato": { select: { name: "In casa" } }
    };

    // Remove undefined props (Notion can be strict) [2](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
    Object.keys(properties).forEach(k => { if (properties[k] === undefined) delete properties[k]; });

    const pageBody = {
      parent: { database_id: cleanDatabaseId },
      properties
    };

    // ✅ Page Cover: needed for Gallery/Preview images [2](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
    if (cleanCoverUrl) {
      pageBody.cover = { type: "external", external: { url: cleanCoverUrl } };
    }

    const createResp = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`, // Bearer auth [4](https://support.google.com/appsheet/answer/15263206?hl=en)
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(pageBody)
    });

    const createText = await createResp.text();

    // ✅ THIS IS THE KEY: always log Notion's real error body
    console.log("NOTION CREATE STATUS:", createResp.status);
    console.log("NOTION CREATE BODY:", createText);

    let createJson;
    try { createJson = JSON.parse(createText); } catch { createJson = { raw: createText }; }

    if (!createResp.ok) {
      return res.status(createResp.status).json({
        error: "Notion create page failed",
        details: createJson
      });
    }

    return res.status(200).json({ status: "created", pageId: createJson.id });

  } catch (err) {
    console.error("FUNCTION CRASH:", err);
    return res.status(500).json({ error: "Server crash", details: String(err) });
  }
};
``
