require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// Vercel běží za proxy, musíme to říct express-rate-limit
app.set('trust proxy', 1);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Globální rate limit - max 100 requestů za 15 minut per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Příliš mnoho requestů, zkus to později' },
  standardHeaders: true,
  legacyHeaders: false,
});

// AI rate limit - max 10 requestů za hodinu per IP (chrání Anthropic/Stability kredity)
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Příliš mnoho AI requestů, zkus to za hodinu' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);
app.use('/ai', aiLimiter);

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/trees', require('./routes/trees'));
app.use('/ai', require('./routes/ai'));
app.use('/votes', require('./routes/votes'));

app.get('/', (req, res) => res.json({ status: 'TreeQuest API running 🌿' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));

module.exports = app;