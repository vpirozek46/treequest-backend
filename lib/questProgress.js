function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // posun na pondělí
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

// Fire-and-forget: nevyvolá výjimku, neblokuje hlavní response
module.exports = function incrementQuest(supabase, user_id, quest_type) {
  const week_start = getWeekStart();
  supabase
    .from('quests')
    .select('id, progress, target')
    .eq('user_id', user_id)
    .eq('quest_type', quest_type)
    .eq('week_start', week_start)
    .eq('completed', false)
    .single()
    .then(({ data: quest }) => {
      if (!quest) return;
      const newProgress = quest.progress + 1;
      return supabase.from('quests').update({
        progress: newProgress,
        completed: newProgress >= quest.target,
      }).eq('id', quest.id);
    })
    .catch(() => {});
};

module.exports.getWeekStart = getWeekStart;
