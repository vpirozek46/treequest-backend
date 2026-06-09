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
  const { image_url, prompt } = req.body;
  if (!image_url || !prompt) return res.status(400).json({ error: 'Chybí data' });
  try {
    const FormData = require('form-data');

    const imgResponse = await fetch(image_url);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

    const form = new FormData();
    form.append('image', imgBuffer, { filename: 'tree.jpg', contentType: 'image/jpeg' });
    form.append('prompt', prompt + ', magical fantasy art, glowing ethereal light, ancient mystical aura, dramatic lighting, highly detailed fantasy illustration');
    form.append('negative_prompt', 'ugly, blurry, low quality, realistic photo');
    form.append('strength', '0.7');
    form.append('output_format', 'jpeg');

    const response = await fetch(
      'https://api.stability.ai/v2beta/stable-image/generate/sd3',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
          'Accept': 'application/json',
          ...form.getHeaders()
        },
        body: form
      }
    );

    const data = await response.json();
    if (!data.image) return res.status(500).json({ error: 'Generování selhalo', detail: data });
    res.json({ image_base64: data.image });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;