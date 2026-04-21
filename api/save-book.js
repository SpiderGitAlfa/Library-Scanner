module.exports = async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ ok: true, method: req.method });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
};
