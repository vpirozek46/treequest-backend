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
router.post('/water', async (req, res) => {
  const { user_id, tree_id } = req.body;

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

  await supabase.from('waterings').insert({ user_id, tree_id });

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

  res.json({ power_score: power, level, water_count: newWater });
});

module.exports = router;