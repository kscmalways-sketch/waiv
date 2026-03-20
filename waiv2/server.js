require('dotenv').config();

const express = require('express');
const https   = require('https');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── JSON 모드 (questions, roadmap용) ───────────────────── */
function callGemini(prompt, maxOutputTokens) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return reject(new Error('GEMINI_API_KEY가 설정되지 않았습니다.'));

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
      headers: { 'Content-Type': 'application/json', 'Content-Length': bodyBuffer.length }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) { return reject(new Error('Gemini 응답 파싱 실패: ' + e.message)); }
        if (parsed.error) return reject(new Error('Gemini API 오류: ' + (parsed.error.message || JSON.stringify(parsed.error))));
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

/* ── Raw 텍스트 모드 (HTML 사이트 생성용) ───────────────── */
function callGeminiRaw(prompt, maxOutputTokens) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return reject(new Error('GEMINI_API_KEY가 설정되지 않았습니다.'));

    const bodyBuffer = Buffer.from(JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: maxOutputTokens
      }
    }), 'utf8');

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': bodyBuffer.length }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) { return reject(new Error('Gemini 응답 파싱 실패: ' + e.message)); }
        if (parsed.error) return reject(new Error('Gemini API 오류: ' + (parsed.error.message || JSON.stringify(parsed.error))));
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

/* ── JSON 파싱 (잘림 자동 복구 포함) ───────────────────── */
function parseJSON(raw) {
  let cleaned = raw
    .replace(/^```json\s*/im, '')
    .replace(/^```\s*/m,      '')
    .replace(/\s*```$/m,      '')
    .trim();

  try { return JSON.parse(cleaned); }
  catch (e) {
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

/* ── POST /api/questions ────────────────────────────────── */
app.post('/api/questions', async (req, res) => {
  const goal = (req.body.goal || '').trim();
  if (!goal) return res.status(400).json({ error: '목표를 입력해주세요.' });

  const prompt = `You are waiv's friendly intake assistant helping complete beginners use AI for the first time.

The user has described a goal. Your tasks:
1. Write a warm, encouraging Korean summary: a one-line title and a 2-3 sentence explanation that makes the user feel their goal is totally achievable.
2. Generate ONLY the minimum necessary clarifying questions in Korean.
   - 3 to 5 questions maximum.
   - Questions must be simple and easy for a non-technical person to answer — no jargon.
   - Each question must be specific to THIS exact goal.
   - Focus on: what the end result should look or feel like, who the target audience is, any existing materials or tools they already have.

Return ONLY this JSON object — no extra text, no markdown:
{
  "summary_title": "목표를 한 줄로 요약 (Korean)",
  "summary_body": "2-3문장 설명, 따뜻하고 격려하는 톤 (Korean)",
  "questions": [
    "쉽고 구체적인 질문 1",
    "쉽고 구체적인 질문 2",
    "쉽고 구체적인 질문 3"
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

    parsed.questions = parsed.questions.slice(0, 5);
    res.json(parsed);
  } catch (e) {
    console.error('[/api/questions]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/roadmap ──────────────────────────────────── */
app.post('/api/roadmap', async (req, res) => {
  const goal    = (req.body.goal    || '').trim();
  const qaPairs = (req.body.qaPairs || '').trim();
  if (!goal) return res.status(400).json({ error: '목표가 없습니다.' });

  const prompt = `You are waiv's friendly guide helping complete beginners achieve their goal using AI — no technical knowledge assumed.

Your most important job is this: the user does not know WHERE to gather results, HOW to combine them, or WHAT the final step looks like. You must make this crystal clear in every step.

Every step must answer three things for the user:
1. 지금 이 단계에서 구체적으로 무엇을 하나요? (which website to open, what to paste, what to click)
2. 이 단계가 끝나면 무엇이 손에 남나요? (the concrete output)
3. 그 결과물을 다음 단계 어디에 어떻게 가져가나요? (exact next action)

Structure into 3 to 4 stages:
- Stage 1: Plan & Write — use Claude, ChatGPT, or Gemini to generate core content or strategy. User saves output to Google Docs or Notion. This document feeds all next steps.
- Stage 2: Create visuals or product — use an image/design AI. Tell the user exactly which tool to open, where to paste the Stage 1 output, and what to save at the end.
- Stage 3 (if needed): Assemble — tell the user exactly where to bring ALL outputs together. Be specific about the assembly location.
- Final stage: Publish or deliver — give the exact final action with zero ambiguity. Example: "Canva 우측 상단 공유 버튼 → PDF 다운로드 클릭".

Return ONLY this JSON object — no extra text, no markdown:
{
  "intro": "로드맵을 친근하게 소개하는 1-2문장. 막막해하지 않아도 된다는 격려 포함. (Korean)",
  "steps": [
    {
      "title": "단계 제목 (Korean)",
      "what_to_do": "지금 이 단계에서 구체적으로 무엇을 하는지. 반드시 어떤 사이트(예: claude.ai, canva.com)를 열고, 무엇을 붙여넣고, 무엇을 클릭하는지 포함. 이 필드는 절대 비워두면 안 됨. (Korean)",
      "output": "이 단계가 끝났을 때 손에 남는 결과물 한 문장. 예: 완성된 블로그 글 초안이 Google Docs에 저장됩니다. (Korean)",
      "next_connection": "이 결과물을 다음 단계 어디에 어떻게 가져가는지. 예: 이 글을 Ctrl+A Ctrl+C로 복사해서 다음 단계 Canva에 붙여넣으세요. 마지막 단계면 이것이 최종 결과물입니다. 라고 쓸 것. (Korean)",
      "model": "AI tool name only — one of: ChatGPT, Claude, Gemini, Perplexity, Midjourney, DALL-E, Runway, ElevenLabs, Canva AI, Notion AI",
      "model_reason": "왜 이 도구를 쓰는지 초보자가 이해할 수 있는 한 줄 이유 (Korean)",
      "prompt": "Ready-to-use English prompt the beginner copies and pastes directly. Specific to the user's goal. No placeholders. Max 250 chars."
    }
  ]
}

Strict rules:
- All Korean fields → Korean only. prompt → English only.
- 3 to 4 steps maximum.
- Model names must NOT include version numbers: write ChatGPT not GPT-4o, Gemini not Gemini 3 Flash, Claude not Claude 3.5.
- what_to_do must name a specific website or app. Never leave it empty.
- next_connection must be actionable — never vague.
- prompt must be immediately usable with zero editing — no brackets or placeholders.

User goal: ${goal}

Clarifying Q&A:
${qaPairs || '(없음)'}`;

  try {
    const raw    = await callGemini(prompt, 2500);
    const parsed = parseJSON(raw);

    if (typeof parsed.intro !== 'string' || !parsed.intro.trim())
      throw new Error('intro 필드가 비어있습니다.');
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0)
      throw new Error('steps 배열이 비어있습니다.');

    parsed.steps.forEach((step) => {
      if ((!step.what_to_do || !step.what_to_do.trim()) && step.description && step.description.trim())
        step.what_to_do = step.description;
      if (!step.output || !step.output.trim())
        step.output = step.what_to_do || '';
      if (!step.next_connection || !step.next_connection.trim())
        step.next_connection = '결과물을 저장한 뒤 다음 단계로 이동하세요.';
    });

    const required = ['title', 'what_to_do', 'output', 'next_connection', 'model', 'model_reason', 'prompt'];
    parsed.steps.forEach((step, i) => {
      required.forEach(key => {
        if (typeof step[key] !== 'string' || !step[key].trim())
          throw new Error(`steps[${i}].${key} 필드가 비어있습니다.`);
      });
    });

    parsed.steps = parsed.steps.slice(0, 4);
    res.json(parsed);
  } catch (e) {
    console.error('[/api/roadmap]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/buildsite ────────────────────────────────── */
app.post('/api/buildsite', async (req, res) => {
  const goal    = (req.body.goal    || '').trim();
  const qaPairs = (req.body.qaPairs || '').trim();
  if (!goal) return res.status(400).json({ error: '목표가 없습니다.' });

  const prompt = `You are an expert web developer and designer. Create a complete, beautiful, production-ready single-file HTML website based on the user's goal.

Requirements:
- Single file: all CSS and JavaScript must be inline within the HTML file
- Modern, clean, professional design with attractive visual hierarchy
- Fully responsive — works perfectly on mobile and desktop
- Include realistic, relevant placeholder content related to the user's goal
- Use attractive color scheme, good typography, smooth CSS animations
- Include navigation, hero section, main content section, and footer at minimum
- Must be completely self-contained — Google Fonts CDN is allowed
- Write real, working HTML/CSS/JavaScript — not placeholder or skeleton code

Return ONLY the raw HTML code. Start immediately with <!DOCTYPE html>. No explanation, no markdown fences, no extra text before or after the HTML.

User's goal: ${goal}

Additional context from user:
${qaPairs || '(없음)'}`;

  try {
    let html = await callGeminiRaw(prompt, 6000);

    // 마크다운 펜스 제거
    html = html
      .replace(/^```html\s*/im, '')
      .replace(/^```\s*/m,      '')
      .replace(/\s*```$/m,      '')
      .trim();

    // HTML 유효성 확인
    if (!html.toLowerCase().includes('<!doctype') && !html.toLowerCase().includes('<html'))
      throw new Error('유효한 HTML이 생성되지 않았습니다. 다시 시도해주세요.');

    res.json({ html });
  } catch (e) {
    console.error('[/api/buildsite]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── Fallback SPA ───────────────────────────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('waiv running → http://localhost:' + PORT);
  console.log('Gemini model : ' + GEMINI_MODEL);
});
