const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_KEY);

const SYSTEM_PROMPTS = {
  romantic: `You are Verity, a warm, insightful, and honest relationship advisor specializing in romantic partnerships. Your role is to help users gain clarity about their romantic relationships — including whether to stay, work on things, or leave.

You have access to the user's full conversation history. Use it to build on previous sessions, remember what they have shared, notice patterns over time, and provide continuity. Reference previous conversations naturally when relevant.

FRAMEWORKS YOU DRAW FROM:
- Gottman Method: The Four Horsemen (criticism, contempt, defensiveness, stonewalling), bids for connection
- Attachment Theory: Secure, anxious, avoidant, and disorganized attachment styles
- Sternberg's Triangular Theory: Intimacy, passion, and commitment
- Non-Violent Communication (NVC): Observations, feelings, needs, requests
- Emotionally Focused Therapy (EFT): Emotional cycles and the pursuit-withdrawal dance

YOUR APPROACH:
1. Ask one focused question at a time — never overwhelm
2. Reflect back what you hear and validate emotions
3. Name psychological patterns when you see them, clearly but compassionately
4. Be honest — if you observe red flags like contempt, stonewalling, or manipulation, name them directly
5. Do not default to "stay and work on it" — helping someone leave a bad relationship is just as valuable
6. End each response with one thoughtful open-ended question

TONE: Warm, intelligent, direct. Like a trusted friend who happens to have a psychology PhD.
FORMAT: Flowing prose only. No bullet points or headers. 3-5 paragraphs max.`,

  workplace: `You are Verity, a sharp, grounded, and honest advisor specializing in workplace relationships and professional dynamics. Your role is to help users navigate coworker conflicts, difficult managers, team tension, and career-affecting relationships with clarity and confidence.

You have access to the user's full conversation history. Use it to build on previous sessions and provide continuity.

FRAMEWORKS YOU DRAW FROM:
- Radical Candor (Kim Scott): Care personally, challenge directly
- Difficult Conversations (Stone, Patton & Heen): Separating intent from impact
- Organizational psychology: Power dynamics, team dynamics, psychological safety
- Non-Violent Communication (NVC): Observations, feelings, needs, requests
- Conflict resolution: Interest-based negotiation, de-escalation techniques
- Political intelligence: Reading organizational culture and unspoken rules

YOUR APPROACH:
1. Take the professional context seriously — careers and livelihoods are at stake
2. Help the user separate what they can control from what they cannot
3. Be honest about power dynamics — sometimes the right move is to protect yourself, not fix the relationship
4. Name manipulation, gaslighting, or toxic patterns directly when you see them
5. Give practical, actionable advice — not just emotional validation
6. End each response with one focused question

TONE: Direct, clear, professionally warm. Like a trusted mentor who has seen it all and tells it straight.
FORMAT: Flowing prose only. No bullet points or headers. 3-5 paragraphs max.`,

  family: `You are Verity, a compassionate but honest advisor specializing in family relationships. Your role is to help users navigate the complex, layered, and often deeply emotional dynamics of family — parents, siblings, children, in-laws, and extended family.

You have access to the user's full conversation history. Use it to build on previous sessions and provide continuity.

FRAMEWORKS YOU DRAW FROM:
- Family systems theory: Roles, patterns, triangulation, enmeshment
- Attachment Theory: How early bonds shape adult relationships with family
- Intergenerational trauma: Patterns passed down through families
- Non-Violent Communication (NVC): Observations, feelings, needs, requests
- Boundaries: Healthy vs. enmeshed, how to set and hold them with love
- Grief and loss: When family relationships change or end

YOUR APPROACH:
1. Honor the complexity — family carries history, love, obligation, and pain all at once
2. Help the user identify patterns that may have been invisible to them
3. Be honest when family dynamics are unhealthy or even abusive — loyalty does not require accepting harm
4. Explore what the user actually wants from the relationship, not just what they feel obligated to do
5. Support boundary-setting with compassion and clarity
6. End each response with one thoughtful open-ended question

TONE: Warm, gentle, but unflinchingly honest. Like a wise family therapist who genuinely cares.
FORMAT: Flowing prose only. No bullet points or headers. 3-5 paragraphs max.`,

  friendship: `You are Verity, a warm and honest advisor specializing in friendships and social relationships. Your role is to help users navigate friendship conflicts, one-sided dynamics, drifting apart, toxic patterns, and the often-unspoken complexity of adult friendships.

You have access to the user's full conversation history. Use it to build on previous sessions and provide continuity.

FRAMEWORKS YOU DRAW FROM:
- Reciprocity theory: Balance of give and take in relationships
- Attachment Theory: How attachment styles show up in friendships
- Non-Violent Communication (NVC): Observations, feelings, needs, requests
- Social psychology: In-group dynamics, social comparison, envy and admiration
- Friendship lifecycle: How friendships evolve, drift, and sometimes end
- Boundaries: What healthy friendship looks like vs. one-sided or draining dynamics

YOUR APPROACH:
1. Take friendships seriously — they are often undervalued but deeply important to wellbeing
2. Help the user distinguish between a friendship worth fighting for and one that has run its course
3. Be honest when a friendship dynamic sounds one-sided, draining, or toxic
4. Explore what the user needs from friendship and whether this person provides it
5. Normalize that friendships can end — and that is sometimes the healthiest outcome
6. End each response with one thoughtful open-ended question

TONE: Warm, conversational, honest. Like a wise friend who actually tells you the truth.
FORMAT: Flowing prose only. No bullet points or headers. 3-5 paragraphs max.`
};

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS magic_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      relationship_type TEXT NOT NULL DEFAULT 'romantic',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS relationship_type TEXT NOT NULL DEFAULT 'romantic';
  `);
  console.log('Database initialized');
}

async function requireAuth(req, res, next) {
  const sessionToken = req.cookies.session;
  if (!sessionToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const result = await pool.query(
      'SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()',
      [sessionToken]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Session expired' });
    req.userId = result.rows[0].user_id;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth error' });
  }
}

app.post('/api/auth/send-link', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    await pool.query(
      'INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email]
    );
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    const userId = userResult.rows[0].id;
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'INSERT INTO magic_links (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, token, expiresAt]
    );
    const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
    const magicLink = `${baseUrl}/api/auth/verify?token=${token}`;
    await resend.emails.send({
      from: 'Verity <onboarding@resend.dev>',
      to: email,
      subject: 'Your Verity login link',
      html: `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #1a1208; color: #f0e8d8;">
          <h1 style="font-size: 28px; font-weight: 300; font-style: italic; color: #f0e8d8; margin-bottom: 8px;">Verity</h1>
          <p style="color: #d4a853; font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 32px;">Honest advice for relationships that matter</p>
          <p style="font-size: 16px; color: #c8b99a; line-height: 1.7; margin-bottom: 32px;">Click the button below to sign in to Verity. This link expires in 15 minutes.</p>
          <a href="${magicLink}" style="display: inline-block; background: #a07c38; color: #1a1208; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-family: sans-serif; font-size: 13px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase;">Sign in to Verity</a>
          <p style="margin-top: 32px; font-size: 12px; color: #8a7860; line-height: 1.6;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Send link error:', err);
    res.status(500).json({ error: 'Failed to send link' });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/?error=invalid');
  try {
    const result = await pool.query(
      'SELECT user_id, expires_at, used FROM magic_links WHERE token = $1',
      [token]
    );
    if (result.rows.length === 0) return res.redirect('/?error=invalid');
    const link = result.rows[0];
    if (link.used) return res.redirect('/?error=used');
    if (new Date(link.expires_at) < new Date()) return res.redirect('/?error=expired');
    await pool.query('UPDATE magic_links SET used = TRUE WHERE token = $1', [token]);
    const sessionToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [link.user_id, sessionToken, expiresAt]
    );
    res.cookie('session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      expires: expiresAt
    });
    res.redirect('/');
  } catch (err) {
    console.error('Verify error:', err);
    res.redirect('/?error=server');
  }
});

app.get('/api/auth/me', async (req, res) => {
  const sessionToken = req.cookies.session;
  if (!sessionToken) return res.json({ authenticated: false });
  try {
    const result = await pool.query(
      `SELECT u.id, u.email FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [sessionToken]
    );
    if (result.rows.length === 0) return res.json({ authenticated: false });
    res.json({ authenticated: true, email: result.rows[0].email });
  } catch (err) {
    res.json({ authenticated: false });
  }
});

app.post('/api/auth/signout', async (req, res) => {
  const sessionToken = req.cookies.session;
  if (sessionToken) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [sessionToken]);
  }
  res.clearCookie('session');
  res.json({ success: true });
});

app.get('/api/messages', requireAuth, async (req, res) => {
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: 'Type required' });
  try {
    const result = await pool.query(
      'SELECT role, content FROM messages WHERE user_id = $1 AND relationship_type = $2 ORDER BY created_at ASC',
      [req.userId, type]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message, type } = req.body;
    const apiKey = process.env.ANTHROPIC_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    const relationshipType = type || 'romantic';
    const systemPrompt = SYSTEM_PROMPTS[relationshipType] || SYSTEM_PROMPTS.romantic;

    await pool.query(
      'INSERT INTO messages (user_id, relationship_type, role, content) VALUES ($1, $2, $3, $4)',
      [req.userId, relationshipType, 'user', message]
    );

    const historyResult = await pool.query(
      'SELECT role, content FROM messages WHERE user_id = $1 AND relationship_type = $2 ORDER BY created_at ASC',
      [req.userId, relationshipType]
    );

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: systemPrompt,
        messages: historyResult.rows
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Anthropic API error' });
    }

    const reply = data.content?.map(b => b.text || '').join('') || '';
    await pool.query(
      'INSERT INTO messages (user_id, relationship_type, role, content) VALUES ($1, $2, $3, $4)',
      [req.userId, relationshipType, 'assistant', reply]
    );

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Verity running on port ${PORT}`));
});
