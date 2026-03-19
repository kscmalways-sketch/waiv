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

app.post('/api/roadmap', async (req, res) => {
  const goal    = (req.body.goal    || '').trim();
  const qaPairs = (req.body.qaPairs || '').trim();
  if (!goal) return res.status(400).json({ error: '목표가 없습니다.' });

  const prompt = `You are waiv's friendly guide helping complete beginners achieve their goal using AI — no technical knowledge assumed.

Your most important job is this: the user does not know WHERE to gather results, HOW to combine them, or WHAT the final step looks like. You must make this crystal clear in every step description. Every step must answer three questions for the user:
1. 지금 이 단계에서 무엇을 하나요? (What do I do right now?)
2. 이 단계가 끝나면 무엇이 손에 남나요? (What do I have when this step is done?)
3. 그 결과물을 어디에, 어떻게 가져가나요? (Where exactly do I take it next — copy-paste into what? upload where? open which tool?)

Structure the roadmap into 3 to 4 stages:
- Stage 1 — Plan & Write: Use an AI chat tool (Claude, ChatGPT, or Gemini) to generate the core content, strategy, or text. The user copies the output into a simple document (Google Docs or Notion). This document is the "source" for all next steps.
- Stage 2 — Create visuals or product: Use an image, design, or specialized AI tool to turn the Stage 1 document into something visual or structured. Tell the user exactly which tool to open, where to paste or upload the Stage 1 output, and what to download or save at the end.
- Stage 3 (if needed) — Assemble & refine: Tell the user exactly where to bring ALL outputs together (e.g. "Google Docs 문서에 1단계 글과 2단계 이미지를 함께 붙여넣으세요" or "Canva에서 새 페이지를 열고..."). Be specific about the assembly location.
- Final stage — Publish or deliver: Tell the user the exact final action — where to click, what to export, where to share. Leave zero ambiguity. Examples: "Canva 우측 상단 '공유' 버튼 → PDF 다운로드", "ChatGPT에서 복사한 글을 네이버 블로그 글쓰기 창에 붙여넣고 발행 버튼 클릭".

Adapt naturally to the user's goal — if 3 stages are enough, use 3.

Return ONLY this JSON object — no extra text, no markdown:
{
  "intro": "로드맵을 친근하게 소개하는 1-2문장. 막막해하지 않아도 된다는 격려 포함. (Korean)",
  "steps": [
    {
      "title": "단계 제목 (Korean, max 20 chars)",
      "what_to_do": "지금 이 단계에서 구체적으로 무엇을 하는지. 어떤 사이트를 열고, 무엇을 붙여넣고, 무엇을 클릭하는지까지 설명. (Korean, max 200 chars)",
      "output": "이 단계가 끝났을 때 손에 남는 결과물이 무엇인지 한 문장으로. 예: '완성된 블로그 글 초안이 Google Docs에 저장됩니다.' (Korean, max 100 chars)",
      "next_connection": "이 결과물을 다음 단계 어디에 어떻게 가져가는지 구체적으로. 예: '이 글을 전체 복사(Ctrl+A → Ctrl+C)해서 다음 단계의 Canva 텍스트 상자에 붙여넣으세요.' 마지막 단계면 '이것이 최종 결과물입니다.'라고 명시. (Korean, max 150 chars)",
      "model": "AI tool name only — one of: ChatGPT, Claude, Gemini, Perplexity, Midjourney, DALL-E, Runway, ElevenLabs, Canva AI, Notion AI",
      "model_reason": "왜 이 도구를 쓰는지 초보자가 이해할 수 있는 한 줄 이유 (Korean, max 60 chars)",
      "prompt": "Ready-to-use English prompt the beginner copies and pastes directly into the AI tool. Specific to the user's exact goal. No placeholders. Max 250 chars."
    }
  ]
}

Strict rules:
- All Korean fields → Korean only. prompt → English only.
- 3 to 4 steps maximum.
- Model names must NOT include version numbers: write 'ChatGPT' not 'GPT-4o', 'Gemini' not 'Gemini 3 Flash', 'Claude' not 'Claude 3.5 Sonnet'.
- what_to_do must name a specific website or app to open (e.g. claude.ai, chat.openai.com, canva.com, docs.google.com).
- next_connection must be actionable — never vague like "다음 단계로 가세요". Always say exactly where and how.
- prompt must be immediately usable with zero editing — no [brackets] or placeholders.

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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('waiv running → http://localhost:' + PORT);
  console.log('Gemini model : ' + GEMINI_MODEL);
});
