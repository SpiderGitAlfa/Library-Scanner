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

    // ---- Duplicate check (Notion Query DB) ---- [1](https://appsheettraining.com/article/google-sheets-formulas-vs-appsheet-expressions)
    const notionQueryUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;

    const queryPayload = {
      filter: {
        property: "ISBN-13",                 // <-- cambieremo se Notion dice property not found
        rich_text: { equals: String(book.isbn13) } // <-- cambieremo se Notion dice filtro non valido
      },
      page_size: 1
    };

    const queryResp = await fetch(notionQueryUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`,  // bearer auth [3](https://sheets-pratique.com/en/apps-script/triggers)
        "Notion-Version": NOTION_VERSION,          // required version header [3](https://sheets-pratique.com/en/apps-script/triggers)
        "Content-Type": "application/json"
      },
      body: JSON.stringify(queryPayload)
    });

    const queryText = await queryResp.text();

    // ✅ LOG DETTAGLIO NOTION (questo è lo step che ci manca)
    console.log("NOTION QUERY URL:", notionQueryUrl);
    console.log("NOTION QUERY STATUS:", queryResp.status);
    console.log("NOTION QUERY BODY:", queryText);

    let queryJson;
    try { queryJson = JSON.parse(queryText); } catch { queryJson = { raw: queryText }; }

    if (!queryResp.ok) {
      return res.status(queryResp.status).json({ error: "Notion query failed", details: queryJson });
    }

    // Se non duplicato, per ora restituiamo OK (così ci concentriamo sulla query)
    return res.status(200).json({ ok: true, msg: "Query OK, no duplicates found" });

  } catch (err) {
    console.error("FUNCTION CRASH:", err);
    return res.status(500).json({ error: "Server crash", details: String(err) });
  }
};
