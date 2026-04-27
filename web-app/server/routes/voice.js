const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authRequired } = require('../middleware/auth');
const { generateAndCacheTTS, CACHE_DIR } = require('../lib/tts');

router.post('/generate', authRequired, async (req, res) => {
  const { npcName, text } = req.body;
  if (!npcName || !text) return res.status(400).json({ error: 'npcName and text required' });

  try {
    const audioUrl = await generateAndCacheTTS(text, npcName);
    res.json({ audioUrl });
  } catch (err) {
    console.error('[TTS]', err.message);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

router.get('/cache/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'audio/wav');
  res.sendFile(filePath);
});

module.exports = router;
