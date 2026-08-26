const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const testKeyRoute = require('./routes/testKey');
const translateAudioRoute = require('./routes/translateAudio');
const ttsRoute = require('./routes/tts');
const translateTextRoute = require('./routes/translateText');
const authRoute = require('./routes/auth');
const adminRoute = require('./routes/admin');
const userConfigRoute = require('./routes/userConfig');
const sessionsRoute = require('./routes/sessions');
const teamLiveRoomsRoute = require('./routes/teamLiveRooms');
const { attachLiveTranslate } = require('./routes/liveTranslate');
const { attachTeamLive } = require('./routes/teamLive');
const { ensureAdminUser } = require('./utils/seedAdmin');

const app = express();
const PORT = process.env.PORT || 3001;

// Resolve allowed CORS origin(s) from env: "*" (any) or a comma-separated list
const corsOriginEnv = (process.env.CORS_ORIGIN || '*').trim();
const corsOrigin =
  corsOriginEnv === '*'
    ? true
    : corsOriginEnv.split(',').map((o) => o.trim()).filter(Boolean);

// Middlewares
app.use(cors({ origin: corsOrigin }));
// Set payload limits high enough to handle base64 audio uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// API Endpoints
app.use('/api', authRoute);
app.use('/api', adminRoute);
app.use('/api', userConfigRoute);
app.use('/api', sessionsRoute);
app.use('/api', teamLiveRoomsRoute);
app.use('/api', testKeyRoute);
app.use('/api', translateAudioRoute);
app.use('/api', ttsRoute);
app.use('/api', translateTextRoute);

// Serve static files from client/dist (React build outputs)
const distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath));

// Fallback all other GET requests to client/dist/index.html for React Router compatibility
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start listening (use raw http.Server so we can attach WebSocket upgrade handler)
const server = http.createServer(app);
attachLiveTranslate(server);
attachTeamLive(server);

// Seed the admin account from .env (ADMIN_USERNAME / ADMIN_PASSWORD) if needed.
ensureAdminUser().catch((err) => console.error('[admin] seed failed:', err));

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`  URL: http://localhost:${PORT}          `);
  console.log(`  WS:  ws://localhost:${PORT}/ws/live-translate`);
  console.log(`  Team WS: ws://localhost:${PORT}/ws/team-live`);
  console.log(`=========================================`);
});
