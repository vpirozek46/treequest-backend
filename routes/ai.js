const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 500;
const MAX_LOCATION_LENGTH = 200;

const VALID_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

router.post('/analyze', async (req, res) => {
  const { image_base64, image_mime, location } = req.body;

  if (!image_base64 || typeof image_base64 !== 'string') return res.status(400).json({ error: 'Chybí obrázek' });
  if (image_base64.length > MAX_IMAGE_SIZE) return res.status(413).json({ error: 'Obrázek je příliš velký' });
  if (location && (typeof location !== 'string' || location.length > MAX_LOCATION_LENGTH)) {
    return res.status(400).json({ error: 'Neplatná lokace' });
  }

  const safeLocation = (location || 'neznámá').replace(/[<>{}\\]/g, '').slice(0, MAX_LOCATION_LENGTH);

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
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image_base64 } },
            {
              type: 'text',
              text: `Jsi expert na stromy. Lokalita: "${safeLocation}". Vrať POUZE JSON bez textu okolo: {"species":"název","title":"epický název max 6 slov česky","age_estimate":"odhad věku","rarity":"Common|Uncommon|Rare|Epic|Legendary","rarity_reason":"1 věta proč tato rarita","power_score":55,"power_reason":"1 věta","epic_description":"3-4 věty poeticky česky","fun_fact":"1 zajímavost","image_prompt":"english SD prompt for magical fantasy version of this exact tree, glowing ethereal light, ancient mystical aura, dramatic lighting, highly detailed fantasy illustration"}. RARITY pravidla: Common=běžný mladý strom, Uncommon=zajímavý druh nebo dobrý stav, Rare=vzácnější druh nebo starší (50+ let), Epic=mimořádný strom (100+ let nebo unikátní), Legendary=skutečný obr nebo unikátní památný strom. Buď fér - většina stromů je Common nebo Uncommon, Legendary jen výjimečně.`
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

    const parsed = JSON.parse(match[0]);
    // Validuj rarity (fallback na Common)
    if (!VALID_RARITIES.includes(parsed.rarity)) parsed.rarity = 'Common';

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/fantasy-image', async (req, res) => {
  const { image_url, prompt, tree_level, tree_id, rarity } = req.body;

  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Chybí prompt' });
  if (prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: 'Prompt je příliš dlouhý' });
  if (tree_level !== undefined && (typeof tree_level !== 'number' || tree_level < 0 || tree_level > 100)) {
    return res.status(400).json({ error: 'Neplatný level' });
  }
  if (tree_id && typeof tree_id !== 'string') return res.status(400).json({ error: 'Neplatné tree_id' });

  // Pokud máme tree_id, načti rarity + ověř vlastnictví
  let treeRarity = rarity || 'Common';
  if (tree_id) {
    const { data: tree } = await supabase.from('trees').select('rarity, power_score, user_id').eq('id', tree_id).single();
    if (tree) {
      if (tree.user_id !== req.user_id) {
        return res.status(403).json({ error: 'Nemůžeš generovat fantasy pro cizí strom' });
      }
      treeRarity = tree.rarity || 'Common';
      const level = tree_level || 0;
      const requiredPower = level < 20 ? 0 : level < 40 ? 20 : level < 60 ? 40 : level < 80 ? 60 : level < 100 ? 80 : 100;
      if (tree.power_score < requiredPower) {
        return res.status(400).json({ error: `Tento level je zamčený - potřebuješ power ${requiredPower}` });
      }
    }
  }

  const safePrompt = prompt.replace(/[<>{}\\]/g, '').slice(0, MAX_PROMPT_LENGTH);

  const level = tree_level || 0;
  const levelKey = level < 20 ? 0 : level < 40 ? 20 : level < 60 ? 40 : level < 80 ? 60 : level < 100 ? 80 : 100;
  const dbColumn = `fantasy_img_${levelKey}`;
  // fantasy_level v DB: levelKey/20 + 1 (level 1-5), nebo 6 pro božský level
  const newFantasyLevel = levelKey === 100 ? 6 : levelKey / 20 + 1;

  // Style podle levelu
  const levelStyle = level < 20
    ? 'subtle magical glow, soft ethereal light, slightly enchanted, gentle fantasy atmosphere'
    : level < 40
    ? 'moderate magical energy, glowing runes on bark, mystical forest spirits, colorful aura'
    : level < 60
    ? 'powerful ancient magic, bright glowing leaves, magical creatures nearby, dramatic lighting, enchanted forest'
    : level < 80
    ? 'epic fantasy tree, intense magical energy, golden and purple aura, floating magical particles, legendary ancient spirit'
    : level < 100
    ? 'ultimate legendary tree, godlike magical power, blinding divine light, massive ethereal crown, celestial energy, mythical beings surrounding it, most epic fantasy illustration possible'
    : 'absolute divine transcendent world-tree, omega-level cosmic power, universe within the crown, stars and galaxies woven into branches, pure blinding divine light beyond all description, reality warping magic, celestial beings kneeling around it, the tree of all creation, impossibly majestic and awe-inspiring, beyond legendary in every way';

  // Style podle rarity (přidá unikátní charakter)
  const rarityStyle = {
    'Common':    'natural earthy tones, simple but charming, warm sunlight',
    'Uncommon':  'enhanced colors, slight bioluminescence on leaves, peaceful forest spirits',
    'Rare':      'cyan and silver magical accents, crystal formations on roots, mysterious atmosphere',
    'Epic':      'deep purple and gold aura, floating magical sigils, runic patterns on bark, ancient power',
    'Legendary': 'rainbow ethereal energy, celestial constellations in branches, divine cosmic atmosphere, world-tree quality',
  }[treeRarity] || 'natural earthy tones';

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
            { text: safePrompt + ', ' + levelStyle + ', ' + rarityStyle + ', fantasy art, highly detailed illustration, epic tree', weight: 1 },
            { text: 'ugly, blurry, low quality, realistic photo, modern', weight: -1 }
          ],
          cfg_scale: 7,
          height: 1024,
          width: 1024,
          steps: 30,
          samples: 1
        })
      }
    );

    const data = await response.json();
    if (!data.artifacts?.[0]?.base64) return res.status(500).json({ error: 'Generování selhalo', detail: data });

    const imageBase64 = data.artifacts[0].base64;

    const uploadResult = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${imageBase64}`,
      { folder: 'treequest/fantasy' }
    );

    if (tree_id) {
      await supabase.from('trees').update({
        [dbColumn]: uploadResult.secure_url,
        fantasy_level: newFantasyLevel,
      }).eq('id', tree_id);
    }

    res.json({ image_base64: imageBase64, image_url: uploadResult.secure_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;