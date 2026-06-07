require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/trees', require('./routes/trees'));
app.use('/ai', require('./routes/ai'));
app.use('/votes', require('./routes/votes'));

app.get('/', (req, res) => res.json({ status: 'TreeQuest API running 🌿' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));