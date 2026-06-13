const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const authMiddleware = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Registrace
router.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username)
    return res.status(400).json({ error: 'Vyplň všechna pole' });

  const safeUsername = username.trim().replace(/[<>{}\\@#]/g, '').slice(0, 30);
  if (!safeUsername) return res.status(400).json({ error: 'Neplatné uživatelské jméno' });

  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { username: safeUsername } }
  });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Registrace úspěšná! Zkontroluj email.' });
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({
    email, password
  });

  if (error) return res.status(401).json({ error: 'Špatný email nebo heslo' });
  res.json({ token: data.session.access_token, user: data.user });
});

// Načti profil
router.get('/profile', authMiddleware, async (req, res) => {
  const user_id = req.user_id;

  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_url, username')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });
  res.json(data);
});

// Nahraj avatar
router.post('/upload-avatar', authMiddleware, async (req, res) => {
  const user_id = req.user_id;
  const { image_base64 } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'Chybí data' });

  try {
    const uploadResult = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${image_base64}`,
      { folder: 'treequest/avatars', public_id: `avatar_${user_id}`, overwrite: true }
    );

    await supabase
      .from('profiles')
      .update({ avatar_url: uploadResult.secure_url })
      .eq('id', user_id);

    res.json({ avatar_url: uploadResult.secure_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Změna username
router.put('/username', authMiddleware, async (req, res) => {
  const user_id = req.user_id;
  const { username } = req.body;
  if (!username || typeof username !== 'string')
    return res.status(400).json({ error: 'Chybí username' });
  const safe = username.trim().replace(/[<>{}\\@#]/g, '').slice(0, 30);
  if (!safe) return res.status(400).json({ error: 'Neplatné jméno' });

  const { error } = await supabase.from('profiles').update({ username: safe }).eq('id', user_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ username: safe });
});

// Denní login bonus
router.post('/daily-bonus', authMiddleware, async (req, res) => {
  const user_id = req.user_id;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('resin, last_login_bonus, login_streak')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });

  const now = Date.now();
  const lastBonus = profile.last_login_bonus ? new Date(profile.last_login_bonus).getTime() : 0;
  const dayMs = 24 * 60 * 60 * 1000;

  if (now - lastBonus < dayMs) {
    return res.json({ already_claimed: true, streak: profile.login_streak || 1 });
  }

  const isConsecutive = lastBonus > 0 && (now - lastBonus) < 2 * dayMs;
  const newStreak = isConsecutive ? (profile.login_streak || 1) + 1 : 1;
  const bonus = 5 + Math.min(5, newStreak - 1); // base 5🌿 + streak bonus až +5
  const newResin = (profile.resin || 0) + bonus;

  await supabase.from('profiles').update({
    resin: newResin,
    last_login_bonus: new Date().toISOString(),
    login_streak: newStreak,
  }).eq('id', user_id);

  res.json({ already_claimed: false, bonus, streak: newStreak, resin: newResin });
});

module.exports = router;