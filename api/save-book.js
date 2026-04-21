module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Notion-Version");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
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

    const NOTION_VERSION = "2026-03-11";

    // 1) Duplicate check
    const queryResp = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`,
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
    let queryJson;
    try { queryJson = JSON.parse(queryText); } catch { queryJson = { raw: queryText }; }

    if (!queryResp.ok) {
      return res.status(queryResp.status).json({ error: "Notion query failed", details: queryJson });
    }

    if (queryJson.results && queryJson.results.length > 0) {
      return res.status(200).json({ status: "duplicate", existingPageId: queryJson.results[0].id });
    }

    // 2) Create page
    const properties = {
      "Titolo": { title: [{ text: { content: book.title || "Senza titolo" } }] },
      "Autore": { rich_text: [{ text: { content: book.author || "" } }] },
      "Casa Editrice": { rich_text: [{ text: { content: book.publisher || "" } }] },
      "ISBN-10": { rich_text: [{ text: { content: book.isbn10 || "" } }] },
      "ISBN-13": { rich_text: [{ text: { content: String(book.isbn13 || "") } }] },
      "ASIN": { rich_text: [{ text: { content: book.asin || "" } }] },
      "Descrizione": { rich_text: [{ text: { content: book.description || "" } }] },
      "Copertina URL": book.coverUrl ? { url: book.coverUrl } : undefined,
      "Posizione": book.location ? { select: { name: book.location } } : undefined,
      "Lingua": book.language ? { select: { name: book.language } } : undefined
    };

    Object.keys(properties).forEach(k => { if (properties[k] === undefined) delete properties[k]; });

    const createResp = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties
      })
    });

    const createText = await createResp.text();
    let createJson;
    try { createJson = JSON.parse(createText); } catch { createJson = { raw: createText }; }

    if (!createResp.ok) {
      return res.status(createResp.status).json({ error: "Notion create page failed", details: createJson });
    }

    return res.status(200).json({ status: "created", pageId: createJson.id });

  } catch (err) {
    console.error("FUNCTION CRASH:", err);
    return res.status(500).json({ error: "Server crash", details: String(err) });
  }
};
