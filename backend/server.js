const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: 5432,
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppass',
  database: process.env.DB_NAME || 'visiospark',
});

const SEED_EVENTS = [
  ['Hackathon', 'Lab 1', '2026-11-20'],
  ['Web Design Contest', 'Lab 2', '2026-11-20'],
  ['Robo Race', 'Main Hall', '2026-11-21'],
  ['Gaming Tournament', 'Auditorium', '2026-11-21'],
  ['Poster Competition', 'Atrium', '2026-11-22'],
];

async function initDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, venue TEXT, event_date DATE)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        event_id INT REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL, email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW())`);
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM events');
      if (rows[0].n === 0) {
        for (const e of SEED_EVENTS) {
          await pool.query('INSERT INTO events(name, venue, event_date) VALUES($1,$2,$3)', e);
        }
      }
      console.log('Database ready');
      return;
    } catch (e) {
      console.log(`DB not ready (${i + 1}/${retries}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  process.exit(1);
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/events', async (req, res) => {
  const r = await pool.query('SELECT * FROM events ORDER BY event_date, id');
  res.json(r.rows);
});

app.get('/api/registrations', async (req, res) => {
  const r = await pool.query(`SELECT g.id, g.name, g.email, e.name AS event
    FROM registrations g JOIN events e ON e.id = g.event_id ORDER BY g.id DESC`);
  res.json(r.rows);
});

app.post('/api/registrations', async (req, res) => {
  const { event_id, name, email } = req.body || {};
  if (!event_id || !name || !email) return res.status(400).json({ error: 'event_id, name and email are required' });
  const r = await pool.query(
    'INSERT INTO registrations(event_id, name, email) VALUES($1,$2,$3) RETURNING *',
    [event_id, name.trim(), email.trim()]);
  res.status(201).json(r.rows[0]);
});

initDb().then(() => app.listen(3000, () => console.log('API listening on 3000')));
