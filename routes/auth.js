const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

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

  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { username } }
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
router.get('/profile', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'Chybí user_id' });

  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_url, username')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });
  res.json(data);
});

// Nahraj avatar
router.post('/upload-avatar', async (req, res) => {
  const { user_id, image_base64 } = req.body;
  if (!user_id || !image_base64) return res.status(400).json({ error: 'Chybí data' });

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

module.exports = router;