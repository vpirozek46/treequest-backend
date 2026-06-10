const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function calculatePowerScore(votes, waterings, visits) {
  return Math.min(100, Math.round((votes * 1.0) + (waterings * 2.5) + (visits * 0.5)));
}

function getLevel(p) {
  if (p <= 20) return 'Sapling';
  if (p <= 40) return 'Grown';
  if (p <= 65) return 'Ancient';
  if (p <= 85) return 'Legendary';
  return 'Mythic';
}

// Hlasovat pro strom
router.post('/vote', async (req, res) => {
  const { user_id, tree_id } = req.body;

  const { error: voteError } = await supabase
    .from('votes').insert({ user_id, tree_id });

  if (voteError) return res.status(400).json({ error: 'Už jsi hlasoval' });

  const { data: tree } = await supabase
    .from('trees')
    .select('votes_count, water_count, visits_count')
    .eq('id', tree_id).single();

  const newVotes = (tree.votes_count || 0) + 1;
  const power = calculatePowerScore(newVotes, tree.water_count, tree.visits_count);
  const level = getLevel(power);

  await supabase.from('trees').update({
    votes_count: newVotes, power_score: power, level
  }).eq('id', tree_id);

  res.json({ power_score: power, level, votes_count: newVotes });
});

// Zalít strom (cooldown 24h)
// Zalít strom (cooldown 24h + water tank)
router.post('/water', async (req, res) => {
  const { user_id, tree_id } = req.body;

  // Načti profil (tank)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('water_tank, tank_level, pump_level, last_refill')
    .eq('id', user_id)
    .single();

  if (profileError) return res.status(404).json({ error: 'Profil nenalezen' });

  // Spočítej aktuální vodu po auto-refillu
  const TANK_CAPACITY = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30 };
  const PUMP_REFILL_AMOUNT = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3 };
  const PUMP_REFILL_HOURS  = { 1: 4, 2: 3, 3: 2, 4: 2, 5: 1, 6: 1 };

  const tankMax    = TANK_CAPACITY[profile.tank_level] || 5;
  const amount     = PUMP_REFILL_AMOUNT[profile.pump_level] || 1;
  const intervalMs = (PUMP_REFILL_HOURS[profile.pump_level] || 4) * 60 * 60 * 1000;
  const lastRefill = new Date(profile.last_refill).getTime();
  const ticks      = Math.floor((Date.now() - lastRefill) / intervalMs);
  const currentWater = Math.min(tankMax, (profile.water_tank || 0) + ticks * amount);
  const newLastRefill = ticks > 0
    ? new Date(lastRefill + ticks * intervalMs).toISOString()
    : profile.last_refill;

  // Zkontroluj tank
  if (currentWater < 1)
    return res.status(400).json({ error: 'Nemáš vodu v tanku! Počkej na doplnění.' });

  // Cooldown 24h
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('waterings')
    .select('id')
    .eq('user_id', user_id)
    .eq('tree_id', tree_id)
    .gte('created_at', yesterday)
    .limit(1);

  if (recent && recent.length > 0)
    return res.status(400).json({ error: 'Zalít můžeš jednou za 24 hodin' });

  // Odečti vodu z tanku
  await supabase.from('profiles').update({
    water_tank: currentWater - 1,
    last_refill: newLastRefill,
  }).eq('id', user_id);

  // Vlož zálití
  await supabase.from('waterings').insert({ user_id, tree_id });

  // Update stromu
  const { data: tree } = await supabase
    .from('trees')
    .select('votes_count, water_count, visits_count')
    .eq('id', tree_id).single();

  const newWater = (tree.water_count || 0) + 1;
  const power = calculatePowerScore(tree.votes_count, newWater, tree.visits_count);
  const level = getLevel(power);

  await supabase.from('trees').update({
    water_count: newWater, power_score: power, level
  }).eq('id', tree_id);

  res.json({
    power_score: power,
    level,
    water_count: newWater,
    tank_water: currentWater - 1,
    tank_max: tankMax,
  });
});

module.exports = router;