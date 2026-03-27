const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─────────────────────────────────────────
// MONGODB CONNECTION
// ─────────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI || 
  'mongodb+srv://<db_username>:<db_password>@analyx.bdv5cpz.mongodb.net/unit2prod?retryWrites=true&w=majority&appName=Analyx';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Atlas connected — Analyx cluster'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

// ─────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────

// Users
const UserSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true },
  name:      { type: String, required: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: ['admin', 'user'], default: 'user' },
  sections:  [String],   // e.g. ['Container', 'Lid']
  color:     { type: String, default: '#00d4ff' },
  active:    { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Production Entry
const EntrySchema = new mongoose.Schema({
  date:      { type: String, required: true },   // "2026-03-26"
  section:   { type: String, required: true },   // "Container"
  plan:      { type: Number, required: true },
  actual:    { type: Number, required: true },
  shift:     { type: String, default: 'Full Day' },
  remarks:   { type: String, default: '' },
  createdBy: { type: String },                   // username
  createdByName: { type: String },
  month:     { type: String },                   // "2026-03"
  createdAt: { type: Date, default: Date.now }
});

// Monthly Summary (auto-calculated)
const SummarySchema = new mongoose.Schema({
  month:    String,
  section:  String,
  capacity: Number,
  monthTarget: Number,
  tillDateTarget: Number,
  tillDateAchieved: Number,
  updatedAt: { type: Date, default: Date.now }
});

const User    = mongoose.model('User',    UserSchema);
const Entry   = mongoose.model('Entry',   EntrySchema);
const Summary = mongoose.model('Summary', SummarySchema);

// ─────────────────────────────────────────
// JWT MIDDLEWARE
// ─────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'unit2_super_secret_key_2026';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ─────────────────────────────────────────
// SEED DEFAULT USERS (runs once on startup)
// ─────────────────────────────────────────
async function seedUsers() {
  const count = await User.countDocuments();
  if (count > 0) return;

  const users = [
    { username:'admin',  name:'Super Admin',  password: await bcrypt.hash('admin123',10), role:'admin', sections:['Container','Lid','Assembly','Charging','Packing','Dispatch'], color:'#f59e0b' },
    { username:'user1',  name:'Ravi Kumar',   password: await bcrypt.hash('user123',10),  role:'user',  sections:['Container','Lid'], color:'#00d4ff' },
    { username:'user2',  name:'Suresh Babu',  password: await bcrypt.hash('user123',10),  role:'user',  sections:['Assembly'], color:'#a855f7' },
    { username:'user3',  name:'Priya Devi',   password: await bcrypt.hash('user123',10),  role:'user',  sections:['Charging'], color:'#ec4899' },
    { username:'user4',  name:'Mohan Rao',    password: await bcrypt.hash('user123',10),  role:'user',  sections:['Packing'],  color:'#22c55e' },
    { username:'user5',  name:'Anita Singh',  password: await bcrypt.hash('user123',10),  role:'user',  sections:['Dispatch'], color:'#f97316' },
  ];
  await User.insertMany(users);
  console.log('✅ Default users seeded into MongoDB');
}

// Seed initial summary from your image data
async function seedSummary() {
  const count = await Summary.countDocuments();
  if (count > 0) return;

  const initial = [
    { section:'Container', capacity:15000, monthTarget:15000, tillDateTarget:11400, tillDateAchieved:10445 },
    { section:'Lid',       capacity:25000, monthTarget:25000, tillDateTarget:19000, tillDateAchieved:16100 },
    { section:'Assembly',  capacity:42000, monthTarget:35000, tillDateTarget:26600, tillDateAchieved:19802 },
    { section:'Charging',  capacity:42000, monthTarget:35000, tillDateTarget:26600, tillDateAchieved:19938 },
    { section:'Packing',   capacity:42000, monthTarget:35000, tillDateTarget:26600, tillDateAchieved:21968 },
    { section:'Dispatch',  capacity:42000, monthTarget:39000, tillDateTarget:29640, tillDateAchieved:18614 },
  ];

  for (const d of initial) {
    await Summary.create({ month:'2026-03', ...d });
  }
  console.log('✅ Initial production summary seeded from image data');
}

mongoose.connection.once('open', () => {
  seedUsers();
  seedSummary();
});

// ─────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, active: true });
  if (!user) return res.status(401).json({ error: 'User not found' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid password' });

  const token = jwt.sign(
    { id: user._id, username: user.username, name: user.name, role: user.role, sections: user.sections, color: user.color },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, user: { username: user.username, name: user.name, role: user.role, sections: user.sections, color: user.color } });
});

// GET /api/me
app.get('/api/me', authMiddleware, (req, res) => res.json(req.user));

// ─────────────────────────────────────────
// ENTRY ROUTES
// ─────────────────────────────────────────

// POST /api/entries  — save a new production entry
app.post('/api/entries', authMiddleware, async (req, res) => {
  const { date, section, plan, actual, shift, remarks } = req.body;

  // Permission check: user can only enter their sections
  if (req.user.role !== 'admin' && !req.user.sections.includes(section)) {
    return res.status(403).json({ error: `You are not allowed to enter data for ${section}` });
  }

  const month = date.substring(0, 7); // "2026-03"

  const entry = await Entry.create({
    date, section, plan, actual, shift, remarks,
    createdBy: req.user.username,
    createdByName: req.user.name,
    month
  });

  // Update running summary
  await Summary.findOneAndUpdate(
    { month, section },
    { $inc: { tillDateAchieved: actual } },
    { upsert: false }
  );

  res.json({ success: true, data: entry });
});

// GET /api/entries — get entries (admin: all; user: own sections)
app.get('/api/entries', authMiddleware, async (req, res) => {
  const { section, month, date } = req.query;
  let filter = {};

  if (req.user.role !== 'admin') {
    filter.section = { $in: req.user.sections };
  }
  if (section && section !== 'all') filter.section = section;
  if (month) filter.month = month;
  if (date) filter.date = date;

  const entries = await Entry.find(filter).sort({ date: -1, createdAt: -1 }).limit(200);
  res.json(entries);
});

// DELETE /api/entries/:id — admin only
app.delete('/api/entries/:id', authMiddleware, adminOnly, async (req, res) => {
  await Entry.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// SUMMARY / DASHBOARD ROUTES
// ─────────────────────────────────────────

// GET /api/summary?month=2026-03
app.get('/api/summary', authMiddleware, async (req, res) => {
  const month = req.query.month || '2026-03';
  const summary = await Summary.find({ month });
  res.json(summary);
});

// PUT /api/summary — admin updates targets
app.put('/api/summary', authMiddleware, adminOnly, async (req, res) => {
  const { month, section, capacity, monthTarget, tillDateTarget } = req.body;
  const updated = await Summary.findOneAndUpdate(
    { month, section },
    { capacity, monthTarget, tillDateTarget },
    { upsert: true, new: true }
  );
  res.json({ success: true, data: updated });
});

// ─────────────────────────────────────────
// USERS ROUTES (admin only)
// ─────────────────────────────────────────

// GET /api/users
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const users = await User.find({}, '-password');
  res.json(users);
});

// POST /api/users — create new user
app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { username, name, password, role, sections, color } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ username, name, password: hashed, role, sections, color });
  res.json({ success: true, data: { username: user.username, name: user.name, role: user.role } });
});

// PUT /api/users/:id — update user
app.put('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, sections, role, active, color } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { name, sections, role, active, color }, { new: true });
  res.json({ success: true, data: user });
});

// PUT /api/users/:id/password — change password
app.put('/api/users/:id/password', authMiddleware, adminOnly, async (req, res) => {
  const hashed = await bcrypt.hash(req.body.password, 10);
  await User.findByIdAndUpdate(req.params.id, { password: hashed });
  res.json({ success: true });
});

// ─────────────────────────────────────────
// EXPORT ROUTE — CSV download
// ─────────────────────────────────────────
app.get('/api/export/csv', authMiddleware, async (req, res) => {
  const month = req.query.month || '2026-03';
  const summary = await Summary.find({ month });

  let csv = 'Section,Capacity,Month Target,Till Date Target,Till Date Achieved,% Achieved\n';
  for (const s of summary) {
    const pct = s.tillDateTarget > 0 ? Math.round(s.tillDateAchieved / s.tillDateTarget * 100) : 0;
    csv += `${s.section},${s.capacity},${s.monthTarget},${s.tillDateTarget},${s.tillDateAchieved},${pct}%\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=unit2_production_${month}.csv`);
  res.send(csv);
});

// ─────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

// ─────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 UNIT-2 Production Server running on port ${PORT}`));
