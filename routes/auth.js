const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Registrace
router.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username)
    return res.status(400).json({ error: 'Vyplň všechna pole' });

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { username }
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
  res.json({
    token: data.session.access_token,
    user: data.user,
    profile: data.user.user_metadata
  });
});

module.exports = router;