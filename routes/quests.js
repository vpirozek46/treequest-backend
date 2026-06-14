const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { getWeekStart } = require('../lib/questProgress');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const QUEST_DEFS = [
  { type: 'water_trees',   target: 10, reward: 25, label: 'Zalij 10× cizí strom'   },
  { type: 'photo_trees',   target: 3,  reward: 30, label: 'Vyfoť 3 nové stromy'    },
  { type: 'collect_votes', target: 50, reward: 40, label: 'Získej 50 hlasů celkem' },
];

// GET /quests/active — vrátí (a případně vytvoří) questy pro aktuální týden
router.get('/active', async (req, res) => {
  const user_id = req.user_id;
  const week_start = getWeekStart();

  const { data: existing } = await supabase
    .from('quests')
    .select('*')
    .eq('user_id', user_id)
    .eq('week_start', week_start);

  const existingTypes = (existing || []).map(q => q.quest_type);
  const toCreate = QUEST_DEFS
    .filter(def => !existingTypes.includes(def.type))
    .map(def => ({
      user_id,
      quest_type: def.type,
      progress: 0,
      target: def.target,
      completed: false,
      claimed: false,
      week_start,
      reward_resin: def.reward,
    }));

  if (toCreate.length > 0) {
    await supabase.from('quests').insert(toCreate);
  }

  const { data: all, error } = await supabase
    .from('quests')
    .select('*')
    .eq('user_id', user_id)
    .eq('week_start', week_start)
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json(all || []);
});

// POST /quests/claim/:id — vyzvedni odměnu za splněný quest
router.post('/claim/:id', async (req, res) => {
  const user_id = req.user_id;

  const { data: quest, error } = await supabase
    .from('quests')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', user_id)
    .single();

  if (error || !quest) return res.status(404).json({ error: 'Quest nenalezen' });
  if (!quest.completed)  return res.status(400).json({ error: 'Quest ještě není dokončen' });
  if (quest.claimed)     return res.status(400).json({ error: 'Odměna už byla vyzvednuta' });

  const { data: profile } = await supabase.from('profiles').select('resin').eq('id', user_id).single();
  const newResin = (profile?.resin || 0) + quest.reward_resin;

  await Promise.all([
    supabase.from('profiles').update({ resin: newResin }).eq('id', user_id),
    supabase.from('quests').update({ claimed: true }).eq('id', quest.id),
  ]);

  res.json({ reward_resin: quest.reward_resin, total_resin: newResin });
});

module.exports = router;
