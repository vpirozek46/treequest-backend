const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Definice balíčků — jediné místo pro ceny a množství
// Až přijde reálná platba, přidej sem `apple_product_id` a `google_product_id`
const RESIN_PACKS = {
  resin_150:  { resin: 150,  price_czk: 29,  label: 'Startér'      },
  resin_400:  { resin: 400,  price_czk: 59,  label: 'Oblíbený'     },
  resin_1000: { resin: 1000, price_czk: 99,  label: 'Velký'        },
  resin_2500: { resin: 2500, price_czk: 199, label: 'Best Value'   },
};

// POST /shop/purchase-resin
// Body: { pack_id }
// Až bude reálná platba: body bude obsahovat i payment_token (Apple/Google/Stripe receipt)
router.post('/purchase-resin', async (req, res) => {
  const user_id = req.user_id;
  const { pack_id } = req.body;

  const pack = RESIN_PACKS[pack_id];
  if (!pack) return res.status(400).json({ error: 'Neplatný balíček' });

  // ── MOCK platba ────────────────────────────────────────────────────────────
  // TODO: Nahradit ověřením platby přes Apple IAP / Google Play / Stripe:
  //   const receipt = req.body.payment_token;
  //   await verifyAppleReceipt(receipt, pack.apple_product_id);
  // ──────────────────────────────────────────────────────────────────────────

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('resin')
    .eq('id', user_id)
    .single();

  if (error) return res.status(404).json({ error: 'Profil nenalezen' });

  const newResin = (profile.resin || 0) + pack.resin;

  await supabase.from('profiles').update({ resin: newResin }).eq('id', user_id);

  // TODO: vložit do tabulky `transactions` pro účetnictví:
  // await supabase.from('transactions').insert({ user_id, pack_id, resin: pack.resin, price_czk: pack.price_czk, created_at: new Date() });

  console.log(`[MOCK PURCHASE] user=${user_id} pack=${pack_id} +${pack.resin} resin`);

  res.json({ success: true, pack_id, resin_added: pack.resin, total_resin: newResin });
});

module.exports = router;
