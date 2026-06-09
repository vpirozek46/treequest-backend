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
  if (!prompt) return res.status(400).json({ error: 'Chybí prompt' });
  try {
    const response = await fetch(
      'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          text_prompts: [
            { text: prompt + ', magical fantasy art, glowing ethereal light, ancient mystical aura, dramatic lighting, highly detailed fantasy illustration, epic tree', weight: 1 },
            { text: 'ugly, blurry, low quality, realistic photo, modern', weight: -1 }
          ],
          cfg_scale: 7,
          height: 768,
          width: 512,
          steps: 30,
          samples: 1
        })
      }
    );
    const data = await response.json();
    if (!data.artifacts?.[0]?.base64) return res.status(500).json({ error: 'Generování selhalo', detail: data });
    res.json({ image_base64: data.artifacts[0].base64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;