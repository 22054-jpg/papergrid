// Study-assistant server for the Past Papers Archive.
// Setup:   npm init -y && npm i express
// Folder:  put index.html and your pdfs/ folder inside ./public
// Run:     GEMINI_API_KEY=your_key node server.js     (Node 18+), then open http://localhost:3000
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const hits = new Map(); // simple per-IP limit: 20 messages a minute
app.post('/api/chat', async (req, res) => {
  const now = Date.now(), recent = (hits.get(req.ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 20) return res.status(429).json({ reply: 'You are sending messages too fast. Wait a minute and try again.' });
  hits.set(req.ip, [...recent, now]);

  const msgs = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-20)
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!msgs.length || msgs[0].role !== 'user' || msgs[msgs.length - 1].role !== 'user')
    return res.status(400).json({ reply: 'No question received.' });

  const subject = typeof req.body.subject === 'string' ? req.body.subject.slice(0, 80) : '';
  const system = `You are a friendly, knowledgeable study assistant on a website of IGCSE past papers. Students are about 13 to 18.
Answer whatever the student asks: school subjects, past-paper questions, study skills, exam technique, planning, motivation, or general curiosity. You are not limited to a fixed list of topics.
Explain step by step for maths and science, and show working. For past-paper questions, teach the reasoning rather than only giving the final answer. Match answer length to the question: short for simple questions, structured for complex ones.
If you are unsure or a question depends on an exact mark scheme, say so instead of guessing. You cannot see the papers on this site or the student's marks.
Format in plain text: short paragraphs, "-" for lists, **bold** for key terms. No headings or tables.${subject ? `\nThe student is currently viewing the ${subject} page.` : ''}`;

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 1024 }
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || r.status);
    const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim();
    if (!text) throw new Error('empty reply');
    res.json({ reply: text });
  } catch (e) {
    console.error('chat error:', e.message);
    res.status(502).json({ reply: 'The assistant is unavailable right now. Please try again shortly.' });
  }
});
app.listen(process.env.PORT || 3000, () => console.log('Running on port ' + (process.env.PORT || 3000)));
