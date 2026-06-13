const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Konstanty pro sociální odměny ──
const RESIN_FOR_WATERING_OTHER = 2;
const RESIN_FOR_VOTING_OTHER = 1;
const RESIN_WHEN_YOUR_TREE_WATERED = 1;
const RESIN_WHEN_YOUR_TREE_VOTED = 0;  // hlasování pro vlastní = 0
const DAILY_SOCIAL_CAP = 30;

// ── Tank constants (musí být stejné jako v tank.js) ──
const TANK_CAPACITY = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30 };
const PUMP_REFILL_AMOUNT = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3 };
const PUMP_REFILL_HOURS = { 1: 4, 2: 3, 3: 2, 4: 2, 5: 1, 6: 1 };

// ── Helpery ──
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

function computeCurrentWater(profile) {
  const tankMax = TANK_CAPACITY[profile.tank_level] || 5;
  const amount = PUMP_REFILL_AMOUNT[profile.pump_level] || 1;
  const intervalMs = (PUMP_REFILL_HOURS[profile.pump_level] || 4) * 60 * 60 * 1000;
  const lastRefill = new Date(profile.last_refill).getTime();
  const ticks = Math.floor((Date.now() - lastRefill) / intervalMs);
  const currentWater = Math.min(tankMax, (profile.water_tank || 0) + ticks * amount);
  const newLastRefill = ticks > 0
    ? new Date(lastRefill + ticks * intervalMs).toISOString()
    : profile.last_refill;
  return { currentWater, newLastRefill, tankMax };
}

// ── Helper: přidá pryskyřici s daily cap ──
async function addSocialResin(userId, amount) {
  if (amount <= 0) return { added: 0, cap_reached: false };

  const { data: profile } = await supabase
    .from('profiles')
    .select('resin, daily_social_resin, last_social_reset')
    .eq('id', userId)
    .single();

  if (!profile) return { added: 0, cap_reached: false };

  // Reset cap pokud uplynul 1 den
  const lastReset = new Date(profile.last_social_reset || 0).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const elapsedDays = Math.floor((Date.now() - lastReset) / dayMs);

  let currentDaily = profile.daily_social_resin || 0;
  let lastResetUpdate = profile.last_social_reset;
  if (elapsedDays >= 1) {
    currentDaily = 0;
    lastResetUpdate = new Date().toISOString();
  }

  // Aplikuj cap
  const remaining = Math.max(0, DAILY_SOCIAL_CAP - currentDaily);
  const toAdd = Math.min(amount, remaining);
  const capReached = toAdd < amount;

  await supabase.from('profiles').update({
    resin: (profile.resin || 0) + toAdd,
    daily_social_resin: currentDaily + toAdd,
    last_social_reset: lastResetUpdate,
  }).eq('id', userId);

  return { added: toAdd, cap_reached: capReached };
}

// ── Helper: přidá pryskyřici bez cap (pro odměny vlastníkovi stromu) ──
async function addResinNoCap(userId, amount) {
  if (amount <= 0) return;
  const { data: profile } = await supabase
    .from('profiles')
    .select('resin')
    .eq('id', userId)
    .single();
  if (!profile) return;
  await supabase.from('profiles').update({
    resin: (profile.resin || 0) + amount,
  }).eq('id', userId);
}

// ── POST /votes/vote ──
router.post('/vote', async (req, res) => {
  const { tree_id } = req.body;
  const user_id = req.user_id;

  const { data: tree, error: treeErr } = await supabase
    .from('trees')
    .select('user_id, votes_count, water_count, visits_count')
    .eq('id', tree_id)
    .single();

  if (treeErr) return res.status(404).json({ error: 'Strom nenalezen' });

  const { error: voteError } = await supabase
    .from('votes').insert({ user_id, tree_id });

  if (voteError) return res.status(400).json({ error: 'Už jsi hlasoval' });

  const newVotes = (tree.votes_count || 0) + 1;
  const power = calculatePowerScore(newVotes, tree.water_count, tree.visits_count);
  const level = getLevel(power);

  await supabase.from('trees').update({
    votes_count: newVotes, power_score: power, level
  }).eq('id', tree_id);

  // Pryskyřice za sociální akce (jen za hlasy na cizí stromy)
  let resinReward = { added: 0, cap_reached: false };
  if (tree.user_id !== user_id) {
    resinReward = await addSocialResin(user_id, RESIN_FOR_VOTING_OTHER);
    // Majitel stromu nedostane nic za hlas (RESIN_WHEN_YOUR_TREE_VOTED = 0)
  }

  res.json({
    power_score: power,
    level,
    votes_count: newVotes,
    resin_earned: resinReward.added,
    cap_reached: resinReward.cap_reached,
  });
});

// ── POST /votes/water (cooldown 24h + tank + pryskyřice) ──
router.post('/water', async (req, res) => {
  const { tree_id } = req.body;
  const user_id = req.user_id;

  // Načti profil (tank)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('water_tank, tank_level, pump_level, last_refill')
    .eq('id', user_id)
    .single();

  if (profileError) return res.status(404).json({ error: 'Profil nenalezen' });

  const { currentWater, newLastRefill, tankMax } = computeCurrentWater(profile);

  if (currentWater < 1)
    return res.status(400).json({ error: 'Nemáš vodu v tanku! Počkej na doplnění.' });

  // Načti strom (kvůli user_id pro pryskyřici)
  const { data: tree, error: treeErr } = await supabase
    .from('trees')
    .select('user_id, votes_count, water_count, visits_count')
    .eq('id', tree_id)
    .single();

  if (treeErr) return res.status(404).json({ error: 'Strom nenalezen' });

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

  await supabase.from('waterings').insert({ user_id, tree_id });

  // Update stromu
  const newWaterCount = (tree.water_count || 0) + 1;
  const power = calculatePowerScore(tree.votes_count, newWaterCount, tree.visits_count);
  const level = getLevel(power);

  await supabase.from('trees').update({
    water_count: newWaterCount, power_score: power, level
  }).eq('id', tree_id);

  // Pryskyřice
  let resinReward = { added: 0, cap_reached: false };
  if (tree.user_id !== user_id) {
    // Zalévající dostane odměnu (s cap)
    resinReward = await addSocialResin(user_id, RESIN_FOR_WATERING_OTHER);
    // Majitel stromu dostane bonus (bez cap - to není sociální farma)
    await addResinNoCap(tree.user_id, RESIN_WHEN_YOUR_TREE_WATERED);
  }

  res.json({
    power_score: power,
    level,
    water_count: newWaterCount,
    tank_water: currentWater - 1,
    tank_max: tankMax,
    resin_earned: resinReward.added,
    cap_reached: resinReward.cap_reached,
  });
});

module.exports = router;