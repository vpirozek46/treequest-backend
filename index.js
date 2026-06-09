require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/trees', require('./routes/trees'));
app.use('/ai', require('./routes/ai'));
app.use('/votes', require('./routes/votes'));

app.get('/', (req, res) => res.json({ status: 'TreeQuest API running 🌿' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));

module.exports = app;