require('dotenv').config();

const express = require('express');
const https   = require('https');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function callGemini(prompt, maxOutputTokens) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return reject(new Error('GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.'));
    }

    const bodyBuffer = Buffer.from(JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: maxOutputTokens,
        responseMimeType: 'application/json'
      }
    }), 'utf8');

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': bodyBuffer.length
      }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          return reject(new Error('Gemini 응답 파싱 실패: ' + e.message));
        }

        if (parsed.error) {
          return reject(new Error('Gemini API 오류: ' + (parsed.error.message || JSON.stringify(parsed.error))));
        }

        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          const reason = parsed?.candidates?.[0]?.finishReason || '알 수 없음';
          return reject(new Error('Gemini 응답이 비어있습니다. (finishReason: ' + reason + ')'));
        }

        resolve(text);
      });
    });

    req.on('error', e => reject(new Error('네트워크 오류: ' + e.message)));
    req.write(bodyBuffer);
    req.end();
  });
}

function parseJSON(raw) {
  let cleaned = raw
    .replace(/^```json\s*/im, '')
    .replace(/^```\s*/m,      '')
    .replace(/\s*```$/m,      '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    let inStr = false, escape = false;
    const stack = [];
    for (const ch of cleaned) {
      if (escape)          { escape = false; continue; }
      if (ch === '\\')     { escape = true;  continue; }
      if (ch === '"')      { inStr = !inStr;  continue; }
      if (inStr)           continue;
      if (ch === '{')      stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    if (inStr) cleaned += '"';
    cleaned = cleaned.replace(/,\s*$/, '');
    while (stack.length) cleaned += stack.pop();

    return JSON.parse(cleaned);
  }
}

app.post('/api/questions', async (req, res) => {
  const goal = (req.body.goal || '').trim();
  if (!goal) return res.status(400).json({ error: '목표를 입력해주세요.' });

  const prompt = `You are waiv's intelligent intake assistant.

The user has described a goal (it may be vague or abstract). Your tasks:
1. Write a concise Korean summary: a one-line title and a 2-3 sentence explanation.
2. Generate ONLY the minimum necessary clarifying questions in Korean.
   - 3 to 6 questions maximum.
   - Each question must be genuinely specific to THIS exact goal — never generic.
   - Think carefully: would this question actually improve the roadmap for this specific goal?

Return ONLY this JSON object — no extra text, no markdown:
{
  "summary_title": "목표를 한 줄로 요약 (Korean)",
  "summary_body": "2-3문장 설명 (Korean)",
  "questions": [
    "구체적인 질문 1",
    "구체적인 질문 2",
    "구체적인 질문 3"
  ]
}

User goal: ${goal}`;

  try {
    const raw    = await callGemini(prompt, 1500);
    const parsed = parseJSON(raw);

    if (typeof parsed.summary_title !== 'string' || !parsed.summary_title.trim())
      throw new Error('summary_title 필드가 비어있습니다.');
    if (typeof parsed.summary_body !== 'string' || !parsed.summary_body.trim())
      throw new Error('summary_body 필드가 비어있습니다.');
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0)
      throw new Error('questions 배열이 비어있습니다.');

    parsed.questions = parsed.questions.slice(0, 6);
    res.json(parsed);

  } catch (e) {
    console.error('[/api/questions]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/roadmap', async (req, res) => {
  const goal    = (req.body.goal    || '').trim();
  const qaPairs = (req.body.qaPairs || '').trim();
  if (!goal) return res.status(400).json({ error: '목표가 없습니다.' });

  const prompt = `You are waiv's roadmap architect. Given the user's goal and their answers to clarifying questions, create a detailed step-by-step AI workflow roadmap.

Return ONLY this JSON object — no extra text, no markdown:
{
  "intro": "전체 로드맵 소개 1-2문장 (Korean)",
  "steps": [
    {
      "title": "단계 제목 (Korean, max 30 chars)",
      "description": "이 단계 설명 2-3문장 (Korean, max 150 chars)",
      "model": "Best AI tool for this step (e.g. Gemini 3 Flash, DALL-E 3, Midjourney, Stable Diffusion, Whisper, ElevenLabs, Runway, Perplexity, etc.)",
      "model_reason": "왜 이 도구인지 이유 한 줄 (Korean, max 60 chars)",
      "prompt": "Ready-to-use English prompt for this step, directly tied to the user goal and answers. Max 250 chars."
    }
  ]
}

Strict rules:
- intro / title / description / model_reason → Korean only.
- prompt → English only.
- 4 to 6 steps total.
- model must be a real, specific AI tool name — not a generic description.
- prompts must directly reflect the user's exact goal — never generic placeholder text.
- Keep all string values within the character limits above.

User goal: ${goal}

Clarifying Q&A:
${qaPairs || '(없음)'}`;

  try {
    const raw    = await callGemini(prompt, 2000);
    const parsed = parseJSON(raw);

    if (typeof parsed.intro !== 'string' || !parsed.intro.trim())
      throw new Error('intro 필드가 비어있습니다.');
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0)
      throw new Error('steps 배열이 비어있습니다.');

    const required = ['title', 'description', 'model', 'model_reason', 'prompt'];
    parsed.steps.forEach((step, i) => {
      required.forEach(key => {
        if (typeof step[key] !== 'string' || !step[key].trim())
          throw new Error(`steps[${i}].${key} 필드가 비어있습니다.`);
      });
    });

    parsed.steps = parsed.steps.slice(0, 6);
    res.json(parsed);

  } catch (e) {
    console.error('[/api/roadmap]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('waiv running → http://localhost:' + PORT);
  console.log('Gemini model : ' + GEMINI_MODEL);
});
