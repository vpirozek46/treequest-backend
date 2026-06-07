const express = require('express');
const router = express.Router();

// Analýza stromu přes Anthropic
router.post('/analyze', async (req, res) => {
  const { image_base64, image_mime, location } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image_mime, data: image_base64 }
            },
            {
              type: 'text',
              text: `Jsi expert na stromy a fantasy spisovatel. Lokalita: "${location || 'neznámá'}". Vrať POUZE JSON:
{"species":"vědecký a český název","title":"epický název max 6 slov","age_estimate":"odhad věku","power_score":55,"power_reason":"1 věta","epic_description":"3-4 věty poeticky","fun_fact":"1 zajímavost","image_prompt":"english Stable Diffusion prompt for magical fantasy version of this tree"}`
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.content.map(i => i.text || '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'AI nevrátila JSON' });
    res.json(JSON.parse(match[0]));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generování magického obrázku
router.post('/magic-image', async (req, res) => {
  const { prompt } = req.body;

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
            { text: prompt, weight: 1 },
            { text: 'ugly, blurry, low quality', weight: -1 }
          ],
          cfg_scale: 7, height: 768, width: 512, steps: 30, samples: 1
        })
      }
    );

    const data = await response.json();
    const b64 = data.artifacts?.[0]?.base64;
    if (!b64) return res.status(500).json({ error: 'Generování selhalo' });
    res.json({ image_base64: b64 });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;