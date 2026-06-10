const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── konstanty ──────────────────────────────────────────────
const TANK_CAPACITY = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30 };
const TANK_UPGRADE_COST = { 2: 200, 3: 500, 4: 1000, 5: 2000, 6: 4000 };

const PUMP_REFILL_AMOUNT = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3 };
const PUMP_REFILL_HOURS  = { 1: 4, 2: 3, 3: 2, 4: 2, 5: 1, 6: 1 };
const PUMP_UPGRADE_COST  = { 2: 150, 3: 400, 4: 900, 5: 1800, 6: 3500 };

const INSTANT_REFILL_COST = 30;

// ── helper: spočítej aktuální vodu po auto-refillu ─────────
function computeCurrentWater(profile) {
  const tankMax    = TANK_CAPACITY[profile.tank_level] || 5;
  const amount     = PUMP_REFILL_AMOUNT[profile.pump_level] || 1;
  const intervalH  = PUMP_REFILL_HOURS[profile.pump_level] || 4;
  const intervalMs = intervalH * 60 * 60 * 1000;

  const now        = Date.now();
  const lastRefill = new Date(profile.last_refill).getTime();
  const elapsed    = now - lastRefill;

  const ticks      = Math.floor(elapsed / intervalMs);
  const gained     = ticks * amount;
  const newWater   = Math.min(tankMax, (profile.water_tank || 0) + gained);

  const newLastRefill = ticks > 0
    ? new Date(lastRefill + ticks * intervalMs).toISOString()
    : profile.last_refill;

  return { newWater, newLastRefill, tankMax, intervalMs };
}

// ── GET /tank/status?user_id=xxx ───────────────────────────
router.get('/status', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'Chybí user_id' });

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('water_tank, tank_level, pump_level, last_refill, resin')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });

  const { newWater, newLastRefill, tankMax, intervalMs } = computeCurrentWater(profile);

  if (newWater !== profile.water_tank) {
    await supabase.from('profiles')
      .update({ water_tank: newWater, last_refill: newLastRefill })
      .eq('id', user_id);
  }

  const nextRefillMs = intervalMs - (Date.now() - new Date(newLastRefill).getTime());

  res.json({
    water_tank: newWater,
    tank_max: tankMax,
    tank_level: profile.tank_level,
    pump_level: profile.pump_level,
    resin: profile.resin,
    next_refill_ms: Math.max(0, nextRefillMs),
    refill_amount: PUMP_REFILL_AMOUNT[profile.pump_level],
    refill_hours: PUMP_REFILL_HOURS[profile.pump_level],
  });
});

// ── POST /tank/instant-refill ──────────────────────────────
router.post('/instant-refill', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Chybí user_id' });

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('water_tank, tank_level, pump_level, last_refill, resin')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });

  const { newWater, tankMax } = computeCurrentWater(profile);

  if (newWater >= tankMax)
    return res.status(400).json({ error: 'Tank je už plný' });

  if ((profile.resin || 0) < INSTANT_REFILL_COST)
    return res.status(400).json({ error: `Nedostatek pryskyřice (potřebuješ ${INSTANT_REFILL_COST} 🌿)` });

  await supabase.from('profiles').update({
    water_tank: tankMax,
    last_refill: new Date().toISOString(),
    resin: profile.resin - INSTANT_REFILL_COST,
  }).eq('id', user_id);

  res.json({ water_tank: tankMax, tank_max: tankMax, resin: profile.resin - INSTANT_REFILL_COST });
});

// ── POST /tank/upgrade-tank ────────────────────────────────
router.post('/upgrade-tank', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Chybí user_id' });

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('tank_level, resin')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });

  const currentLevel = profile.tank_level || 1;
  const nextLevel = currentLevel + 1;

  if (nextLevel > 6)
    return res.status(400).json({ error: 'Tank je na maximálním levelu' });

  const cost = TANK_UPGRADE_COST[nextLevel];
  if ((profile.resin || 0) < cost)
    return res.status(400).json({ error: `Nedostatek pryskyřice (potřebuješ ${cost} 🌿)` });

  await supabase.from('profiles').update({
    tank_level: nextLevel,
    resin: profile.resin - cost,
  }).eq('id', user_id);

  res.json({
    tank_level: nextLevel,
    tank_max: TANK_CAPACITY[nextLevel],
    resin: profile.resin - cost,
  });
});

// ── POST /tank/upgrade-pump ────────────────────────────────
router.post('/upgrade-pump', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Chybí user_id' });

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('pump_level, resin')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });

  const currentLevel = profile.pump_level || 1;
  const nextLevel = currentLevel + 1;

  if (nextLevel > 6)
    return res.status(400).json({ error: 'Čerpadlo je na maximálním levelu' });

  const cost = PUMP_UPGRADE_COST[nextLevel];
  if ((profile.resin || 0) < cost)
    return res.status(400).json({ error: `Nedostatek pryskyřice (potřebuješ ${cost} 🌿)` });

  await supabase.from('profiles').update({
    pump_level: nextLevel,
    resin: profile.resin - cost,
  }).eq('id', user_id);

  res.json({
    pump_level: nextLevel,
    refill_amount: PUMP_REFILL_AMOUNT[nextLevel],
    refill_hours: PUMP_REFILL_HOURS[nextLevel],
    resin: profile.resin - cost,
  });
});

// ── POST /tank/add-resin (debug / budoucí IAP) ─────────────
router.post('/add-resin', async (req, res) => {
  const { user_id, amount } = req.body;
  if (!user_id || !amount || typeof amount !== 'number' || amount <= 0)
    return res.status(400).json({ error: 'Neplatná data' });
  if (amount > 10000)
    return res.status(400).json({ error: 'Příliš mnoho pryskyřice' });

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('resin')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });

  const newResin = (profile.resin || 0) + amount;
  await supabase.from('profiles').update({ resin: newResin }).eq('id', user_id);

  res.json({ resin: newResin });
});

module.exports = router;