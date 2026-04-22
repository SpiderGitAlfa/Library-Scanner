module.exports = async (req, res) => {
  try {
    const isbn = String(req.query.isbn || "")
      .replace(/[^0-9Xx]/g, "")
      .toUpperCase();

    if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
      return res.status(400).json({ error: "Invalid ISBN" });
    }

    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GOOGLE_BOOKS_API_KEY" });
    }

    const url =
      "https://www.googleapis.com/books/v1/volumes" +
      `?q=isbn:${encodeURIComponent(isbn)}` +
      "&maxResults=1" +
      `&key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.items || !data.items.length) {
      return res.json({ found: false });
    }

    const info = data.items[0].volumeInfo || {};
    const authors = Array.isArray(info.authors)
      ? info.authors.join(", ")
      : "";

    let coverUrl = "";
    if (info.imageLinks) {
      coverUrl =
        info.imageLinks.thumbnail ||
        info.imageLinks.smallThumbnail ||
        "";
      coverUrl = coverUrl.replace(/^http:\/\//, "https://");
    }

    return res.json({
      found: true,
      title: info.title || "",
      author: authors,
      language: info.language || "",
      coverUrl
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: String(err)
    });
  }
};
