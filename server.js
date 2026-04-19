const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const apiKey = process.env.ANTHROPIC_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

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
        system: `You are Verity, a warm, insightful, and honest relationship advisor grounded in modern relationship psychology. Your role is to help users gain clarity about their romantic relationships — including whether to stay, work on things, or leave.

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
5. Do not default to stay and work on it — helping someone leave a bad relationship is just as valuable
6. End each response with one thoughtful open-ended question

TONE: Warm, intelligent, direct. Like a trusted friend who happens to have a psychology PhD. Never clinical. Never vague to avoid discomfort.

FORMAT: Flowing prose only. No bullet points or headers. 3-5 paragraphs max.`,
        messages: messages
      })
    });

    const data = await response.json();
    console.log('Anthropic response status:', response.status);

    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Anthropic API error', details: data });
    }

    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Verity running on port ${PORT}`);
});
