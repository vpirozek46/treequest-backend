const express = require('express');
const router = express.Router();

router.post('/analyze', async (req, res) => {
  const { image_base64, image_mime, location } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'Chybí obrázek' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: image_base64 }
            },
            {
              type: 'text',
              text: `Jsi expert na stromy. Lokalita: "${location || 'neznámá'}". Vrať POUZE JSON bez textu okolo: {"species":"název","title":"epický název max 6 slov česky","age_estimate":"odhad věku","power_score":55,"power_reason":"1 věta","epic_description":"3-4 věty poeticky česky","fun_fact":"1 zajímavost","image_prompt":"english SD prompt for magical fantasy version of this exact tree, glowing ethereal light, ancient mystical aura, dramatic lighting, highly detailed fantasy illustration"}`
            }
          ]
        }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content.map(i => i.text || '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'AI nevrátila JSON', raw: text });
    res.json(JSON.parse(match[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/fantasy-image', async (req, res) => {
  const { image_url, prompt, tree_level } = req.body;
  if (!image_url || !prompt) return res.status(400).json({ error: 'Chybí data' });

  const level = tree_level || 0;

  const levelStyle = level < 20
    ? 'subtle magical glow, soft ethereal light, slightly enchanted, gentle fantasy atmosphere'
    : level < 40
    ? 'moderate magical energy, glowing runes on bark, mystical forest spirits, colorful aura'
    : level < 60
    ? 'powerful ancient magic, bright glowing leaves, magical creatures nearby, dramatic lighting, enchanted forest'
    : level < 80
    ? 'epic fantasy tree, intense magical energy, golden and purple aura, floating magical particles, legendary ancient spirit'
    : 'ultimate legendary tree, godlike magical power, blinding divine light, massive ethereal crown, celestial energy, mythical beings surrounding it, most epic fantasy illustration possible';

  try {
    const axios = require('axios');
    const FormData = require('form-data');

    const imgResponse = await fetch(image_url);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

    const form = new FormData();
    form.append('image', imgBuffer, { filename: 'tree.jpg', contentType: 'image/jpeg' });
    form.append('prompt', prompt + ', ' + levelStyle + ', fantasy art, highly detailed illustration');
    form.append('negative_prompt', 'ugly, blurry, low quality, realistic photo, modern buildings');
    form.append('strength', '0.7');
    form.append('output_format', 'jpeg');
    form.append('mode', 'image-to-image');

    const response = await axios.post(
      'https://api.stability.ai/v2beta/stable-image/generate/sd3',
      form,
      {
        headers: {
          'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
          'Accept': 'application/json',
          ...form.getHeaders()
        }
      }
    );

    if (!response.data.image) return res.status(500).json({ error: 'Generování selhalo', detail: response.data });
    res.json({ image_base64: response.data.image });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});
module.exports = router;