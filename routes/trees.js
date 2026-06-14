const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const incrementQuest = require('../lib/questProgress');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const VALID_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_SPECIES_LENGTH = 100;
const MAX_LOCATION_LENGTH = 200;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// ── Passive resin generování ──────────────────────────────
const RARITY_MULTIPLIER = {
  Common: 0.1,
  Uncommon: 0.2,
  Rare: 0.4,
  Epic: 0.7,
  Legendary: 1.2,
};

const FANTASY_LEVEL_MULTIPLIER = {
  0: 1,
  1: 1.5,
  2: 2,
  3: 3,
  4: 4,
  5: 6,
  6: 10,
};

const MAX_ACCUMULATION_HOURS = 24;

function calculateResinRate(rarity, fantasyLevel) {
  const r = RARITY_MULTIPLIER[rarity] || 0.1;
  const l = FANTASY_LEVEL_MULTIPLIER[fantasyLevel] || 1;
  return r * l; // 🌿/hodinu
}

function computeAccumulated(tree) {
  const rate = calculateResinRate(tree.rarity, tree.fantasy_level);
  const lastCollected = new Date(tree.last_collected || tree.created_at).getTime();
  const elapsedMs = Date.now() - lastCollected;
  const elapsedHours = Math.min(MAX_ACCUMULATION_HOURS, elapsedMs / 3600000);
  return Math.floor((tree.accumulated_resin || 0) + rate * elapsedHours * 100) / 100;
}

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

// ── Získat všechny stromy (feed) nebo stromy uživatele ──
router.get('/', async (req, res) => {
  const { user_id } = req.query;

  let query = supabase
    .from('trees')
    .select('*, profiles(username, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (user_id) query = query.eq('user_id', user_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Připoč pending resin pro každý strom
  const trees = data.map(t => ({ ...t, pending_resin: computeAccumulated(t) }));
  res.json(trees);
});

// ── Stromy pro mapu ──
router.get('/map', async (req, res) => {
  const { data, error } = await supabase
    .from('trees')
    .select('id, title, lat, lng, level, power_score, photo_url, rarity')
    .not('lat', 'is', null);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Detail stromu ──
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('trees')
    .select('*, profiles(username, avatar_url)')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Strom nenalezen' });

  // Přidej pending resin
  data.pending_resin = computeAccumulated(data);
  res.json(data);
});

// ── Přidat strom ──
router.post('/', async (req, res) => {
  const {
    title, species, description, age_estimate,
    location_name, lat, lng, photo_base64,
    magic_photo_url, power_score, image_prompt,
    rarity
  } = req.body;
  const user_id = req.user_id;

  if (photo_base64 && photo_base64.length > MAX_IMAGE_SIZE)
    return res.status(413).json({ error: 'Obrázek je příliš velký' });

  const safeTitle = (title || '').replace(/[<>{}\\]/g, '').slice(0, MAX_TITLE_LENGTH);
  const safeSpecies = (species || '').replace(/[<>{}\\]/g, '').slice(0, MAX_SPECIES_LENGTH);
  const safeDescription = (description || '').replace(/[<>{}\\]/g, '').slice(0, MAX_DESCRIPTION_LENGTH);
  const safeLocation = (location_name || '').replace(/[<>{}\\]/g, '').slice(0, MAX_LOCATION_LENGTH);

  let photo_url = null;
  if (photo_base64) {
    const upload = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${photo_base64}`,
      { folder: 'treequest' }
    );
    photo_url = upload.secure_url;
  }

  const level = getLevel(power_score || 0);
  const safeRarity = VALID_RARITIES.includes(rarity) ? rarity : 'Common';
  const safePower = Math.min(100, Math.max(0, Number(power_score) || 0));

  const { data, error } = await supabase.from('trees').insert({
    user_id,
    title: safeTitle, species: safeSpecies, description: safeDescription,
    age_estimate: age_estimate || null,
    location_name: safeLocation, lat: lat || null, lng: lng || null,
    photo_url, magic_photo_url,
    power_score: safePower,
    level, image_prompt,
    rarity: safeRarity,
    fantasy_level: 0,
    last_collected: new Date().toISOString(),
    accumulated_resin: 0,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Quest: vyfoť 3 nové stromy
  incrementQuest(supabase, user_id, 'photo_trees');

  res.json(data);
});

// ── Vyzvednout nastřádanou pryskyřici ──
router.post('/:id/collect-resin', async (req, res) => {
  const user_id = req.user_id;

  const { data: tree, error: treeErr } = await supabase
    .from('trees')
    .select('user_id, rarity, fantasy_level, last_collected, accumulated_resin, created_at')
    .eq('id', req.params.id)
    .single();

  if (treeErr) return res.status(404).json({ error: 'Strom nenalezen' });
  if (tree.user_id !== user_id) return res.status(403).json({ error: 'Nemůžeš sbírat z cizího stromu' });

  const pending = computeAccumulated(tree);
  const collected = Math.floor(pending);

  if (collected < 1) return res.status(400).json({ error: 'Není co vyzvednout' });

  // Reset akumulace
  await supabase.from('trees').update({
    last_collected: new Date().toISOString(),
    accumulated_resin: 0,
  }).eq('id', req.params.id);

  // Přidej pryskyřici do profilu
  const { data: profile } = await supabase
    .from('profiles')
    .select('resin')
    .eq('id', user_id)
    .single();

  const newResin = (profile?.resin || 0) + collected;
  await supabase.from('profiles').update({ resin: newResin }).eq('id', user_id);

  res.json({ collected, total_resin: newResin });
});

module.exports = router;