const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function calculatePowerScore(votes, waterings, visits) {
  const raw = (votes * 1.0) + (waterings * 2.5) + (visits * 0.5);
  return Math.min(100, Math.round(raw));
}

function getLevel(power) {
  if (power <= 20) return 'Sapling';
  if (power <= 40) return 'Grown';
  if (power <= 65) return 'Ancient';
  if (power <= 85) return 'Legendary';
  return 'Mythic';
}

// Získat všechny stromy (feed)
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('trees')
    .select('*, profiles(username, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Získat stromy pro mapu
router.get('/map', async (req, res) => {
  const { data, error } = await supabase
    .from('trees')
    .select('id, title, lat, lng, level, power_score, photo_url')
    .not('lat', 'is', null);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Detail jednoho stromu
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('trees')
    .select('*, profiles(username, avatar_url)')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Strom nenalezen' });
  res.json(data);
});

// Přidat strom
router.post('/', async (req, res) => {
  const {
    title, species, description, age_estimate,
    location_name, lat, lng, photo_base64,
    magic_photo_url, power_score, image_prompt,
    user_id
  } = req.body;

  let photo_url = null;
  if (photo_base64) {
    const upload = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${photo_base64}`,
      { folder: 'treequest' }
    );
    photo_url = upload.secure_url;
  }

  const level = getLevel(power_score || 0);

  const { data, error } = await supabase.from('trees').insert({
    user_id, title, species, description, age_estimate,
    location_name, lat: lat || null, lng: lng || null,
    photo_url, magic_photo_url,
    power_score: power_score || 0,
    level, image_prompt
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;