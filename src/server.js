// src/server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const publicRoutes   = require('./routes/publicRoutes');
const internalRoutes = require('./routes/internalRoutes');
const errorHandler      = require('./middleware/errorHandler');
const proxyController   = require('./controllers/proxyController');

const app = express();
app.use(express.json());

// Routes
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  
  // Fast exit for OPTIONS preflight requests (required by browsers for seeking)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use('/v2/api', publicRoutes);
app.use('/v2/internal', internalRoutes);

// HEAD is needed so video players can discover content-length before seeking
app.all("/proxy/oppai/:server/:encoded_url", proxyController.streamProxy);

app.get("/img/ep/:encoded_url", proxyController.episodeImageProxy);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// Error handler (must be last)
app.use(errorHandler);

// DB + Start
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(process.env.PORT || 3000, () =>
      console.log(`Server running on port ${process.env.PORT || 3000}`)
    );
  })
  .catch(err => { console.error(err); process.exit(1); });

// package.json dependencies
// npm install express mongoose axios node-cache dotenv mongodb