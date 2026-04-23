const express = require("express");
const multer = require("multer");
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json({ limit: "2mb" }));
 
app.get("/", (req, res) => {
  res.send("Langoo backend is running");
});
 
const PORT = process.env.PORT || 10000;
 
// ===============================
// CHAT (kept untouched — legacy endpoint used by some flows)
// ===============================
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message" });
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You generate simple English learning content. Return exactly 3 lines. Each line must follow this format: English sentence - Translation."
          },
          { role: "user", content: message }
        ],
        temperature: 0.9
      })
    });
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const sentences = content
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.includes(" - "))
      .map(line => {
        const parts = line.split(" - ");
        return { text: (parts[0] || "").trim(), translation: parts.slice(1).join(" - ").trim() };
      });
    res.json({ result: JSON.stringify(sentences) });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});
 
// ===============================
// DICTO-FLASH TRANSLATE — dedicated endpoint
// Auto-detects ANY source language (French, Spanish, Italian, German,
// Portuguese, Dutch, Chinese, Japanese, Arabic, Russian, Hindi, etc.)
// and returns a strict dictionary entry in English. Typo-tolerant.
// ===============================
app.post("/dicto-flash/translate", async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing query" });
    }
    const trimmed = query.trim();
    if (!trimmed) {
      return res.status(400).json({ error: "Empty query" });
    }
 
    const system =
`You are a compact multilingual dictionary for a language-learning app called Langoo.
 
RULES:
- The user's input can be in ANY language of the world. You MUST auto-detect the source language from the text itself — never assume based on any external hint.
- Your ONLY job is to translate to English and return a dictionary entry.
- Be aggressively tolerant of: typos, missing accents, mid-word spaces, phonetic spellings, common misspellings. Examples:
    "va ca" → Spanish "vaca" → English "cow"
    "hola" → English "hello"
    "bonsoire" → French "bonsoir" → English "good evening"
    "perro" → English "dog"
    "guten tag" → English "good day"
    "ciao" → English "hi / bye"
    "arigato" → Japanese "ありがとう" → English "thank you"
    "merhaba" → Turkish → English "hello"
    "shukran" → Arabic → English "thank you"
- If the user typed in English, return the clearest canonical English form.
- Examples and synonyms must be in ENGLISH.
- Return STRICT JSON ONLY — no markdown, no commentary, no code fences.
 
JSON SHAPE (required keys, no extras):
{
  "source": "cleaned original user query (trimmed, corrected typos)",
  "target": "best English translation",
  "partOfSpeech": "noun|verb|adjective|adverb|phrase|question|expression",
  "categoryHint": "one short category in English (e.g. 'animal', 'greeting', 'food')",
  "examples": ["short English example 1", "short English example 2"],
  "synonyms": ["short English synonym 1", "short English synonym 2", "short English synonym 3"]
}`;
 
    const user = `Auto-detect the source language of this input and return the English dictionary entry as STRICT JSON:\n\n${trimmed}`;
 
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user }
        ]
      })
    });
 
    const data = await response.json();
    const raw  = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
 
    const clean = (v) => (typeof v === "string" ? v.trim() : "");
    const arrClean = (a) => Array.isArray(a)
      ? a.map(clean).filter(x => x.length > 0).slice(0, 6)
      : [];
 
    const out = {
      source:       clean(parsed.source)       || trimmed,
      target:       clean(parsed.target)       || "",
      partOfSpeech: clean(parsed.partOfSpeech) || "phrase",
      categoryHint: clean(parsed.categoryHint) || "",
      examples:     arrClean(parsed.examples),
      synonyms:     arrClean(parsed.synonyms)
    };
 
    res.json(out);
  } catch (error) {
    console.error("dicto-flash/translate error:", error);
    res.status(500).json({ error: "translate error" });
  }
});
 
// ===============================
// PRONUNCIATION TTS — ultra-natural OpenAI voice
// Client (Pronunciation exercise) POSTs { text, voice? } and gets MP3 audio.
// Uses the newest gpt-4o-mini-tts model with the calm, modern "nova" voice.
// The client caches the result in NSCache so repeat listens are instant.
// ===============================
app.post("/pronunciation/tts", async (req, res) => {
  try {
    const { text = "", voice = "sage" } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }
    // Allowed voices on gpt-4o-mini-tts.
    // Default is now "sage" — warmer, more human, breathier than "nova".
    // "shimmer" and "ballad" are also good warm options.
    const allowed = new Set([
      "nova", "shimmer", "alloy", "sage", "verse", "coral", "ash", "ballad", "echo", "fable", "onyx"
    ]);
    const voiceSafe = allowed.has(voice) ? voice : "sage";
 
    const instructions =
`Voice: warm, human, patient — like a friendly native-speaker teacher on a phone call.
Pace: unhurried, with the tiny micro-pauses a real person would leave between words.
Intonation: natural American English rhythm, gentle musicality, never robotic or sing-songy.
Articulation: crystal-clear so a learner can catch every consonant, while staying relaxed.
No theatrical emphasis, no over-smiling tone — just a calm, real human voice.`;
 
    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voiceSafe,
        input: text,
        instructions,
        format: "mp3"
      })
    });
 
    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => "");
      console.error("pronunciation/tts upstream error:", ttsRes.status, errText);
      return res.status(502).json({ error: "tts upstream error" });
    }
 
    const arrayBuf = await ttsRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=604800"); // 7 days
    res.send(buf);
  } catch (error) {
    console.error("pronunciation/tts error:", error);
    res.status(500).json({ error: "pronunciation tts error" });
  }
});
 
// ===============================
// REALTIME TOKEN (existing, untouched)
// ===============================
function getLanguageName(code) {
  switch ((code || "").toLowerCase()) {
    case "fr": return "French";
    case "de": return "German";
    case "it": return "Italian";
    case "es": return "Spanish";
    case "pt": return "Portuguese";
    case "nl": return "Dutch";
    case "ar": return "Arabic";
    case "ru": return "Russian";
    case "zh":
    case "zh-cn":
    case "zh-hans": return "Chinese";
    case "ja": return "Japanese";
    case "ko": return "Korean";
    case "tr": return "Turkish";
    case "pl": return "Polish";
    case "sv": return "Swedish";
    case "no":
    case "nb": return "Norwegian";
    case "da": return "Danish";
    case "fi": return "Finnish";
    case "cs": return "Czech";
    case "el": return "Greek";
    case "he": return "Hebrew";
    case "hi": return "Hindi";
    case "id": return "Indonesian";
    case "vi": return "Vietnamese";
    case "th": return "Thai";
    case "uk": return "Ukrainian";
    case "ro": return "Romanian";
    case "hu": return "Hungarian";
    case "en": return "English";
    default:   return "the user's native language";
  }
}
 
app.get("/realtime/token", async (req, res) => {
  try {
    const nativeLanguage = getLanguageName(req.query.native_language || "fr");
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
          audio: {
            output: { voice: "shimmer" },
            input: {
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: 450,
                threshold: 0.5,
                create_response: true
              }
            }
          },
          instructions: `You are a friendly English conversation partner. The user's native language is ${nativeLanguage}. Speak naturally and keep answers short and conversational.`
        }
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Realtime token error" });
  }
});
 
// ===============================
// VOICE COACH TOKEN — FLAGSHIP  (upgraded: more demanding, more sophisticated)
// ===============================
const SCENARIOS = {
  free:    `You are MAX — a witty, warm, native English-speaking friend who genuinely enjoys conversation. You keep it alive, natural, engaging, and you gently challenge the user when they coast.`,
  cafe:    `You are MAX — a charming London barista who chats with customers while making drinks. Stay in character, spontaneous, a little playful.`,
  airport: `You are MAX — an efficient Heathrow check-in agent. Friendly but professional, with realistic airport pacing.`,
  job:     `You are MAX — an encouraging English recruiter. You push the user to articulate themselves clearly and ask thoughtful follow-ups.`,
  street:  `You are MAX — a friendly London local helping with directions. You use authentic street phrasing and local color.`,
  phone:   `You are MAX — a warm English receptionist. Calls feel real, paced naturally, professional.`,
};
 
const BASE_INSTRUCTIONS = (scenarioPrompt, nativeLang) => `
${scenarioPrompt}
 
IDENTITY: You are MAX, a native English speaker. Warm, calm, demanding friend — not a cheerleader, not a textbook. Native language support: ${nativeLang}.
 
OPENING LINE (mandatory first sentence, exact): "Hello! How are you today? What can I do for you?" Then stop. Wait for the user.
 
RULES:
- Replies SHORT: 1 sentence preferred, 2 max. Never 3.
- ONE simple question per turn.
- No "great job" / "well done" / cheerleading. Ever.
- Speak slowly, natural intonation, contractions OK. Let silence exist.
- Match the user's register (casual/professional).
 
IF USER SEEMS LOST (long pause, "sorry?", unrelated reply, speaks ${nativeLang}):
→ ONE short sentence in ${nativeLang} to rephrase, then model the English again, then resume in English.
 
PRONUNCIATION COACHING (flagship job):
Listen for: "th" → s/z/d/t, r/l or v/w confusion, dropped final consonants, wrong stress, missing linking, vowel collapse.
When a mispronunciation actually matters (a native would notice):
1. Gently stop. In ${nativeLang}, ONE sentence: what sound was off + how it should sound (phonetic hint the ${nativeLang} speaker can parse).
2. Model the correct word twice, slow.
3. Ask them to repeat. If better: "Yes — that's it." If still off: ONE more hint (mouth shape or similar ${nativeLang} sound), then move on. Max 2 retries, ever.
Do NOT coach every word — only what a native would notice. Keep it inside natural dialogue, never a drill.
 
GRAMMAR: Never point out a mistake. RECAST — repeat their idea back correctly, then continue.
  User: "Yesterday I go to shop." You: "Oh, you went to the shop yesterday? What did you buy?"
Wrong word / false friend: gently slip the right word into your reply. Max one correction per turn.
 
COMPREHENSION: If unclear, don't fake it. Ask "Sorry — did you mean X or Y?" in English. If stuck, ONE sentence in ${nativeLang}, then back to English.
 
PROGRESSIVE CHALLENGE: After a few turns, gently raise the bar (richer vocab, one phrasal verb or idiom, slightly more open questions). If they struggle: shorten, slow down, drop register.
 
BILINGUAL: Default English. Switch to ${nativeLang} only briefly (ONE sentence) for real need: translation, stuck user, explicit grammar question. Always return to English.
 
GOAL: Make the user sound less like a tourist and more like a native. Warm, demanding, real. Never lecture. Never cheer.
`;
 
app.get("/voice-coach/token", async (req, res) => {
  try {
    const scenarioId     = req.query.scenario        || "free";
    const nativeLangCode = req.query.native_language || "fr";
    const nativeLang     = getLanguageName(nativeLangCode);
    const scenarioPrompt = SCENARIOS[scenarioId] || SCENARIOS["free"];
    const instructions   = BASE_INSTRUCTIONS(scenarioPrompt, nativeLang);
 
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
          instructions: instructions,
          // NOTE: on avait "max_response_output_tokens: 120" ici pour capper
          // la longueur audio de MAX, mais la nouvelle API Realtime GA
          // (endpoint /v1/realtime/client_secrets) rejette ce paramètre au
          // niveau session ("Unknown parameter: session.max_response_output_tokens").
          // On le retire: la consigne "1 phrase, 2 max, jamais 3" dans le prompt
          // fait déjà le travail de limitation de longueur. Aucune perte côté coût.
          audio: {
            // marin = newest, most natural-sounding voice in the GA lineup.
            // Warmer, calmer, less "AI-ish" than shimmer/alloy.
            // Alternatives if marin is unavailable: "cedar", "sage", "ash".
            output: { voice: "marin" },
            input: {
              // NOTE: Whisper-1 input transcription intentionally disabled.
              // We no longer need on-screen subtitles or live scoring in Voice Coach
              // (live scores are kept for the Pronunciation exercise, which is a
              // different endpoint). Removing it saves ~$0.006/min of audio input.
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: 1400,    // wait ~1.4s of silence before MAX replies → natural pacing
                threshold: 0.5,
                prefix_padding_ms: 300,
                create_response: true          // MAX replies automatically
              }
            }
          }
        }
      })
    });
 
    const data = await response.json();
    if (data.error) {
      console.error("OpenAI error:", data.error);
      return res.status(500).json({ error: data.error.message });
    }
    res.json(data);
  } catch (error) {
    console.error("Voice coach token error:", error);
    res.status(500).json({ error: "Voice coach token error" });
  }
});
 
// ===============================
// VOICE COACH — PUSH-TO-TALK PIPELINE (new, ~200× cheaper than Realtime)
// -------------------------------------------------------------------
// multipart/form-data:
//   audio          : file (m4a/aac/mp3/wav) — user's spoken turn
//   scenario       : "free" | "cafe" | "airport" | "job" | "street" | "phone"
//   native_language: "fr" | "es" | ... (ISO code)
//   history_json   : JSON string, array of { role: "user"|"ai", text: "..." } (last N turns)
//
// Pipeline:
//   1. Whisper (gpt-4o-mini-transcribe) → user_transcript
//   2. GPT-4o-mini with MAX persona + history → ai_reply (short, 1–2 sentences)
//   3. gpt-4o-mini-tts (voice: "shimmer") → mp3 audio → base64
//
// Response JSON:
//   { user_transcript, ai_reply, ai_audio_base64, ai_audio_format: "mp3" }
//
// Cost per turn (indicative):
//   Whisper  ~10s audio  → ~$0.001
//   LLM      ~200 tokens → ~$0.00015
//   TTS      ~150 chars  → ~$0.0001
//   TOTAL                 → ~$0.0012 / turn  (≈ 200× cheaper than Realtime minute)
// ===============================
app.post("/voice-coach/turn", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ error: "Missing audio" });
    }
 
    const scenarioId     = (req.body.scenario || "free").toString();
    const nativeLangCode = (req.body.native_language || "fr").toString();
    const nativeLang     = getLanguageName(nativeLangCode);
    const scenarioPrompt = SCENARIOS[scenarioId] || SCENARIOS["free"];
 
    // --- Parse optional conversation history ---------------------------
    let history = [];
    try {
      const raw = req.body.history_json;
      if (raw && typeof raw === "string") {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          history = parsed
            .filter(t => t && typeof t === "object" && typeof t.text === "string")
            .map(t => ({
              role: t.role === "ai" ? "assistant" : "user",
              content: String(t.text).slice(0, 800)
            }))
            .slice(-16); // hard cap
        }
      }
    } catch (_) { history = []; }
 
    // ===============================
    // 1. TRANSCRIBE (gpt-4o-mini-transcribe — Whisper-family, cheaper than whisper-1)
    // Uses Node 18+ built-in FormData + Blob — no external deps needed.
    // ===============================
    const sttForm = new FormData();
    const audioBlob = new Blob([req.file.buffer], {
      type: req.file.mimetype || "audio/m4a"
    });
    const fname = (req.file.originalname && req.file.originalname.trim())
      ? req.file.originalname
      : "turn.m4a";
    sttForm.append("file", audioBlob, fname);
    sttForm.append("model", "gpt-4o-mini-transcribe");
    sttForm.append("response_format", "json");
    // No language hint — we want to catch when the user falls back to
    // their native language (MAX handles that gracefully).
 
    const sttRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: sttForm
    });
 
    if (!sttRes.ok) {
      const errText = await sttRes.text().catch(() => "");
      console.error("voice-coach/turn STT upstream error:", sttRes.status, errText);
      return res.status(502).json({ error: "stt upstream error" });
    }
 
    const sttData = await sttRes.json();
    const userTranscript = (sttData?.text || "").trim();
    if (!userTranscript) {
      // Silent / unintelligible audio — still answer kindly.
      const softReply = "Sorry, I didn't catch that — could you say it again?";
      const audioB64 = await ttsBase64(softReply, "shimmer");
      return res.json({
        user_transcript: "",
        ai_reply:        softReply,
        ai_audio_base64: audioB64 || "",
        ai_audio_format: "mp3"
      });
    }
 
    // ===============================
    // 2. LLM REPLY (GPT-4o-mini with MAX persona)
    // ===============================
    const systemPrompt = BASE_INSTRUCTIONS(scenarioPrompt, nativeLang) + `
 
OUTPUT FORMAT (very strict for this channel):
- Reply with ONE line of plain text — no markdown, no stage directions, no emojis.
- 1 sentence preferred, 2 max. Never 3. Keep it under ~30 words.
- Do NOT prefix with "MAX:" or any speaker label.
`;
 
    const messages = [{ role: "system", content: systemPrompt }];
    for (const h of history) messages.push(h);
    messages.push({ role: "user", content: userTranscript });
 
    const llmRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 160,
        messages
      })
    });
 
    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => "");
      console.error("voice-coach/turn LLM upstream error:", llmRes.status, errText);
      return res.status(502).json({ error: "llm upstream error" });
    }
 
    const llmData = await llmRes.json();
    let aiReply = (llmData?.choices?.[0]?.message?.content || "").trim();
    // Clean up common artifacts.
    aiReply = aiReply.replace(/^["'`]+|["'`]+$/g, "");
    aiReply = aiReply.replace(/^MAX\s*:\s*/i, "");
    if (!aiReply) {
      aiReply = "Mm — tell me a bit more about that?";
    }
 
    // ===============================
    // 3. TTS (gpt-4o-mini-tts, voice: shimmer)
    // ===============================
    const audioB64 = await ttsBase64(aiReply, "shimmer");
    if (!audioB64) {
      return res.status(502).json({ error: "tts upstream error" });
    }
 
    res.json({
      user_transcript: userTranscript,
      ai_reply:        aiReply,
      ai_audio_base64: audioB64,
      ai_audio_format: "mp3"
    });
  } catch (error) {
    console.error("voice-coach/turn error:", error);
    res.status(500).json({ error: "voice coach turn error" });
  }
});
 
// Helper — synthesize speech with gpt-4o-mini-tts and return base64 MP3.
async function ttsBase64(text, voice = "shimmer") {
  try {
    const allowed = new Set([
      "nova", "shimmer", "alloy", "sage", "verse", "coral", "ash", "ballad", "echo", "fable", "onyx", "marin", "cedar"
    ]);
    const voiceSafe = allowed.has(voice) ? voice : "shimmer";
 
    const instructions =
`Voice: warm, native English friend on a phone call. Calm, grounded, human.
Pacing: natural, unhurried, with small real breaths between clauses.
Intonation: friendly rise and fall, understated emotion, never theatrical.
Tone: encouraging, patient, real — like talking to a friend, not a teacher.
Neutral American English. Crisp but unforced articulation.`;
 
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voiceSafe,
        input: text,
        instructions,
        format: "mp3"
      })
    });
 
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      console.error("voice-coach tts upstream error:", upstream.status, errText);
      return null;
    }
 
    const arrayBuf = await upstream.arrayBuffer();
    return Buffer.from(arrayBuf).toString("base64");
  } catch (e) {
    console.error("voice-coach ttsBase64 error:", e);
    return null;
  }
}
 
// ===============================
// NATIVE MODE — "Can you fool a native?"
// Phonetic challenge exercise (replaces Real Talk).
// ===============================
 
const NATIVE_THEME_LABELS = {
  free:   "everyday life, random, spontaneous",
  street: "street life, directions, casual encounters, small talk",
  cafe:   "cafe, restaurant, ordering food or drinks, small talk with staff",
  travel: "travel, airport, hotel, transport, booking, tourism",
  work:   "office, job interview, meeting, professional phone call"
};
 
// Strict word-count ranges per difficulty. The server counts words in the
// generated sentence and regenerates if it falls outside the range.
const NATIVE_WORD_RANGES = {
  easy:      { min: 3,  max: 5  },
  medium:    { min: 6,  max: 10 },
  hard:      { min: 11, max: 16 },
  nightmare: { min: 15, max: 22 }
};
 
const NATIVE_DIFFICULTY_LABELS = {
  easy:
`VERY SHORT BEGINNER sentence. HARD LIMIT: 3 to 5 words total, never more.
Beginner vocabulary only. NO contractions. NO slang. NO reductions.
It must be something a complete beginner can read and repeat.
Examples (shape + length):
- "I love my dog."
- "She is very tired."
- "We go to school."
- "The sky is blue."`,
  medium:
`Casual native phrasing. HARD LIMIT: 6 to 10 words total, never more.
Contractions allowed (I'm, don't, you're). Include one clearly tricky phonetic feature
(linking, 'th', long vowel, /r/ vs /l/). Feels like everyday spoken English.
Examples (shape + length):
- "I'm running late, grab me a coffee please."
- "She really didn't mean to hurt your feelings."
- "There's something weird about the way he talks."`,
  hard:
`Fast casual native speech. HARD LIMIT: 11 to 16 words total, never more.
Pack in connected speech: reductions ('gonna', 'wanna', 'kinda', 'lemme'),
linking across words, weak forms, tricky consonant clusters.
Must sound like a real person talking at full speed.
Examples (shape + length):
- "I was gonna grab a bite but I kinda lost track of the time."
- "You wouldn't believe the stuff he said after we got to the party."`,
  nightmare:
`Phonetic nightmare. HARD LIMIT: 15 to 22 words total, never more.
Designed to EXPOSE non-natives: heavy reductions, tons of linking, th+r clusters,
/æ/ vs /ʌ/, stress-timing traps, idiomatic chunks natives blurt without thinking.
Should feel intimidating even to advanced learners.
Examples (shape + length):
- "Honestly she shoulda told him straight up that the whole thing was pretty much a waste of his time anyway."
- "You're telling me he literally walked out of the meeting without saying a single word to anyone the entire afternoon?"`
};
 
// Count REAL spoken words in a sentence. Contractions like "I'm", "don't"
// count as ONE word (matches how a user would say them). Punctuation is ignored.
function nativeWordCount(text) {
  if (!text || typeof text !== "string") return 0;
  const cleaned = text
    .replace(/[\u2018\u2019]/g, "'")   // smart quotes → straight
    .replace(/[^A-Za-z'\- ]+/g, " ")   // strip everything except letters, ' and -
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}
 
app.post("/native-mode/sentence", async (req, res) => {
  try {
    const {
      native_language = "fr",
      difficulty      = "medium",
      theme           = "free",
      recent          = []
    } = req.body || {};
 
    const nativeLang      = getLanguageName(native_language);
    const themeLabel      = NATIVE_THEME_LABELS[theme]      || NATIVE_THEME_LABELS.free;
    const difficultyLabel = NATIVE_DIFFICULTY_LABELS[difficulty] || NATIVE_DIFFICULTY_LABELS.medium;
    const range           = NATIVE_WORD_RANGES[difficulty]   || NATIVE_WORD_RANGES.medium;
 
    const avoid = Array.isArray(recent) ? recent.slice(-30).join(" | ") : "";
 
    const buildSystem = (retryHint = "") => (
`You generate ONE short English sentence for a pronunciation challenge called "Native Mode".
The goal: the user must repeat it out loud and try to sound native.
 
Rules:
- Output STRICT JSON only, no markdown, no commentary.
- JSON shape:
{
  "id": "short unique slug, a-z0-9 and dashes, max 24 chars",
  "text": "the English sentence",
  "phonetic": "a phonetic hint written in ${nativeLang} orthography so a ${nativeLang} speaker can approximate the sound",
  "translation": "translation of the sentence in ${nativeLang}",
  "theme": "${theme}",
  "difficulty": "${difficulty}"
}
- The sentence theme: ${themeLabel}.
- Difficulty style: ${difficultyLabel}
- ABSOLUTE RULE: the "text" field MUST contain between ${range.min} and ${range.max} spoken words (contractions like "I'm" = 1 word). Count before answering. If out of range, REWRITE a shorter or longer one.
- The sentence MUST feel natural. At "easy", clean beginner English is fine.
- NEVER reuse any of these previously served sentences: ${avoid || "(none)"}
- Be creative, surprising, fresh. Vary openings, grammar, registers.
- No quotation marks inside "text".${retryHint}`
    );
 
    const userMsg = `Generate a fresh ${difficulty} ${theme} sentence now. Remember: strict JSON only, between ${range.min} and ${range.max} words.`;
 
    async function tryGenerate(retryHint = "") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 1.05,
          top_p: 0.95,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildSystem(retryHint) },
            { role: "user",   content: userMsg }
          ]
        })
      });
      const data = await response.json();
      const raw  = data?.choices?.[0]?.message?.content || "{}";
      try { return JSON.parse(raw); } catch (_) { return {}; }
    }
 
    // Generate, then validate word count. Up to 2 retries with a stronger hint.
    let parsed = await tryGenerate();
    let wc = nativeWordCount(parsed?.text);
    let attempts = 1;
    while ((wc < range.min || wc > range.max) && attempts < 3) {
      const hint =
        `\n- RETRY: previous attempt had ${wc} words which is OUT OF the required ${range.min}-${range.max} range. Produce a new sentence that is STRICTLY within the range this time.`;
      parsed = await tryGenerate(hint);
      wc = nativeWordCount(parsed?.text);
      attempts++;
    }
 
    // If STILL out of range after retries, trim/fallback on the easy tier so
    // we never ship a 15-word "easy" sentence.
    if (wc < range.min || wc > range.max) {
      if (difficulty === "easy") {
        parsed = {
          ...parsed,
          text: "I love my dog.",
          phonetic: parsed?.phonetic || null,
          translation: parsed?.translation || "J'aime mon chien."
        };
      }
    }
 
    const out = {
      id:          parsed.id          || `nm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
      text:        parsed.text        || "What are you up to this weekend?",
      phonetic:    parsed.phonetic    || null,
      translation: parsed.translation || null,
      theme:       parsed.theme       || theme,
      difficulty:  parsed.difficulty  || difficulty
    };
 
    console.log(`[native-mode] difficulty=${difficulty} words=${nativeWordCount(out.text)} range=${range.min}-${range.max} attempts=${attempts}`);
 
    res.json(out);
  } catch (error) {
    console.error("native-mode/sentence error:", error);
    res.status(500).json({ error: "native-mode sentence error" });
  }
});
 
app.post("/native-mode/score", async (req, res) => {
  try {
    const {
      target          = "",
      transcript      = "",
      confidence      = 0,        // 0..1 — Apple Speech recognizer confidence
      native_language = "fr"
    } = req.body || {};
 
    if (!target || typeof target !== "string") {
      return res.status(400).json({ error: "Missing target" });
    }
 
    const nativeLang = getLanguageName(native_language);
 
    // Strip ALL punctuation for comparison — punctuation is not spoken.
    const stripPunct = (s) => (s || "")
      .toLowerCase()
      .replace(/[\p{P}\p{S}]+/gu, " ")   // punctuation + symbols
      .replace(/\s+/g, " ")
      .trim();
 
    const cleanTarget     = stripPunct(target);
    const cleanTranscript = stripPunct(transcript);
 
    // Clamp confidence to 0..1 and render as percentage for the prompt
    const confClamped = Math.max(0, Math.min(1, Number(confidence) || 0));
    const confPct     = Math.round(confClamped * 100);
 
    const system =
`You are a STRICT phonetic pronunciation judge for an English-learning app called Langoo.
 
Your job: score how NATIVE the user sounded when they tried to repeat a target sentence.
The PRIMARY goal of the exercise is PHONETIC ACCURACY. Word accuracy matters less than sounding native.
 
You will receive:
- TARGET: the sentence the user was asked to say (with punctuation).
- TRANSCRIPT: what Apple's on-device speech recognizer heard (best guess in words).
- RECOGNIZER CONFIDENCE: a 0-100 number reflecting how clearly the recognizer understood the user. Low confidence strongly suggests unclear pronunciation.
 
STRICT RULES:
1. Punctuation is NEVER spoken. IGNORE ALL commas, periods, question marks, exclamation marks, apostrophes, hyphens, quotes, etc. Compare the spoken words ONLY. A missing pause for a comma NEVER counts as an error.
2. Casing, accents, and extra spaces are irrelevant.
3. Contractions and their expansions are equivalent ("I am" == "I'm", "do not" == "don't").
4. Common homophones/near-homophones that result from speech-to-text are NOT a user error ("for" vs "four", "their" vs "there"). Give full credit.
5. The RECOGNIZER CONFIDENCE is your main phonetic signal:
   - confidence >= 85 AND transcript matches target → native territory (90-100).
   - confidence 70-84 AND transcript matches → speaker (75-89).
   - confidence 45-69 with decent match → learner (50-74).
   - confidence < 45 OR transcript barely matches → tourist (0-39).
6. If the transcript words match perfectly but confidence is high, award 95-100. Do NOT deduct for missing punctuation.
7. If transcript is empty or gibberish, score <= 15.
 
OUTPUT FORMAT — STRICT JSON ONLY, no markdown:
{
  "score": integer 0-100,
  "grade": one of "tourist" | "learner" | "speaker" | "native",
  "feedback_native": one short sentence (max 18 words) in ${nativeLang}, warm, specific, actionable. Focus on PHONETIC advice (which sound to soften, which vowel to relax, linking, stress).
  "feedback_english": one short sentence in English, same vibe, same length.
}
 
Feedback rules:
- Never shame. Encouraging but honest.
- If accuracy is high but confidence is low → praise the words, point at pronunciation clarity.
- If a specific word likely tripped them → name it.
- Never mention punctuation in the feedback.`;
 
    const user =
`TARGET: ${target}
TARGET (compare form): ${cleanTarget}
 
TRANSCRIPT: ${transcript || "(empty)"}
TRANSCRIPT (compare form): ${cleanTranscript || "(empty)"}
 
RECOGNIZER CONFIDENCE: ${confPct}/100
 
Judge now. Remember: punctuation is NEVER an error. Return JSON only.`;
 
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user   }
        ]
      })
    });
 
    const data = await response.json();
    const raw  = data?.choices?.[0]?.message?.content || "{}";
 
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
 
    let score = parseInt(parsed.score, 10);
    if (isNaN(score)) score = 0;
    score = Math.max(0, Math.min(100, score));
 
    const grades = ["tourist", "learner", "speaker", "native"];
    let grade = grades.includes(parsed.grade) ? parsed.grade : null;
    if (!grade) {
      if      (score >= 90) grade = "native";
      else if (score >= 70) grade = "speaker";
      else if (score >= 40) grade = "learner";
      else                  grade = "tourist";
    }
 
    res.json({
      score,
      grade,
      feedback_native:  parsed.feedback_native  || null,
      feedback_english: parsed.feedback_english || null
    });
  } catch (error) {
    console.error("native-mode/score error:", error);
    res.status(500).json({ error: "native-mode score error" });
  }
});
 
// ===============================
// ECHO 🪞 — flagship new exercise
// "Speak. Hear yourself, but native."
// Flow: user speaks freely → Whisper transcribes → GPT rewrites into
// polished native English preserving their personality → TTS speaks
// the rewrite → client shows BEFORE/AFTER + fluency scores + share card.
// ===============================
 
// --- Situational prompt pool: real-world English scenarios the learner must
//     handle out loud. Either a practical roleplay (At the hotel, at the
//     restaurant, at the airport, …) or a simple opinion question
//     (What's your favourite colour and why?). The AI scores the user's
//     spoken answer on CONTENT APPROPRIATENESS + ENGLISH CORRECTNESS +
//     PHONETIC CLARITY.
const ECHO_PROMPTS = [
  // --- SIMPLE — short, beginner-friendly questions (majority)
  { emoji: "🎨", title: "What is your favourite colour?",                       hint: "Say why in one sentence.",        tag: "simple" },
  { emoji: "🍎", title: "What is your favourite food?",                         hint: "Say when you eat it.",            tag: "simple" },
  { emoji: "🐶", title: "Do you prefer cats or dogs?",                          hint: "Say one reason.",                 tag: "simple" },
  { emoji: "☀️", title: "Do you prefer summer or winter?",                      hint: "Say one thing you like about it.", tag: "simple" },
  { emoji: "🎵", title: "What music do you like?",                              hint: "Name one singer or band.",        tag: "simple" },
  { emoji: "⚽", title: "What sport do you like?",                              hint: "Say if you play it.",             tag: "simple" },
  { emoji: "📺", title: "What is your favourite movie?",                        hint: "Say if it is funny or sad.",      tag: "simple" },
  { emoji: "🏠", title: "Describe your bedroom in a few words.",                hint: "Colour, size, one object.",       tag: "simple" },
  { emoji: "🕐", title: "What do you do in the morning?",                       hint: "Three simple things.",            tag: "simple" },
  { emoji: "🌆", title: "What is your favourite place in your city?",           hint: "Say why you like it.",            tag: "simple" },
  { emoji: "🚗", title: "How do you go to work or school?",                     hint: "Car, bus, bike, walk?",           tag: "simple" },
  { emoji: "🎮", title: "What do you do to relax?",                             hint: "One or two things.",              tag: "simple" },
  { emoji: "📅", title: "What did you do yesterday?",                           hint: "Two or three short sentences.",   tag: "simple" },
  { emoji: "🍳", title: "What do you eat for breakfast?",                       hint: "List two or three things.",       tag: "simple" },
  { emoji: "👨‍👩‍👧", title: "Tell me about your family.",                            hint: "Who, how many, names.",           tag: "simple" },
  { emoji: "🌧️", title: "How is the weather today?",                            hint: "Sun, rain, cold, hot?",           tag: "simple" },
  { emoji: "🎂", title: "When is your birthday?",                               hint: "Say the month and day.",          tag: "simple" },
  { emoji: "🐾", title: "Do you have a pet?",                                   hint: "If yes, describe it.",            tag: "simple" },
  { emoji: "🍕", title: "What food do you NOT like?",                           hint: "Say why.",                        tag: "simple" },
  { emoji: "📚", title: "Do you like reading books?",                           hint: "Say what kind.",                  tag: "simple" },
  { emoji: "🏖️", title: "Describe your perfect weekend.",                       hint: "Two or three activities.",        tag: "simple" },
  { emoji: "🎁", title: "What is the best gift you received?",                  hint: "Who gave it to you?",             tag: "simple" },
  { emoji: "🎤", title: "What is your name and where are you from?",            hint: "Introduce yourself simply.",      tag: "simple" },
  { emoji: "🧭", title: "Where do you live?",                                   hint: "City, country, house or flat?",   tag: "simple" },
  { emoji: "🚶", title: "How old are you?",                                     hint: "Say when you were born.",         tag: "simple" },
 
  // --- SIMPLE roleplays — everyday, short, realistic
  { emoji: "☕", title: "Order a coffee at a café.",                             hint: "Say size and pay.",               tag: "simple-roleplay" },
  { emoji: "🧀", title: "Ask for bread and cheese at a shop.",                  hint: "Say thank you at the end.",       tag: "simple-roleplay" },
  { emoji: "🛒", title: "Ask where the milk is in a supermarket.",              hint: "Be polite.",                      tag: "simple-roleplay" },
  { emoji: "🚕", title: "Ask a taxi driver to go to the airport.",              hint: "Ask the price too.",              tag: "simple-roleplay" },
  { emoji: "🏨", title: "At the hotel, ask for the Wi-Fi password.",            hint: "Be polite.",                      tag: "simple-roleplay" },
  { emoji: "🍽️", title: "Ask for the bill at a restaurant.",                    hint: "Thank the waiter.",               tag: "simple-roleplay" },
  { emoji: "👋", title: "Say hello and introduce yourself to a new classmate.", hint: "Ask their name too.",             tag: "simple-roleplay" },
  { emoji: "📞", title: "Call a friend to say hello.",                          hint: "Ask how they are.",               tag: "simple-roleplay" },
  { emoji: "🦷", title: "Tell a doctor you have a small pain.",                 hint: "Say where it hurts.",             tag: "simple-roleplay" },
  { emoji: "💊", title: "At the pharmacy, ask for something for a cold.",       hint: "Keep it short.",                  tag: "simple-roleplay" },
  { emoji: "🧭", title: "Ask a stranger where the bus stop is.",                hint: "Be polite and say thank you.",    tag: "simple-roleplay" },
  { emoji: "📮", title: "Send a postcard at the post office.",                  hint: "Ask the price.",                  tag: "simple-roleplay" },
  { emoji: "🛍️", title: "Ask the seller how much a shirt costs.",               hint: "Say if you want it or not.",      tag: "simple-roleplay" },
 
  // --- A FEW harder situational prompts (kept short but more detailed)
  { emoji: "🏨", title: "At the hotel, book a room for two nights with breakfast.", hint: "Dates, number of guests.",           tag: "advanced-roleplay" },
  { emoji: "✈️", title: "At airport check-in, ask for a window seat.",               hint: "Say your destination.",              tag: "advanced-roleplay" },
  { emoji: "🚆", title: "Buy a return train ticket for tomorrow.",                   hint: "Ask about the price and platform.", tag: "advanced-roleplay" },
  { emoji: "💼", title: "Introduce yourself to a new colleague at work.",             hint: "Name, role, something friendly.",   tag: "advanced-roleplay" },
  { emoji: "🎯", title: "Describe a goal you want to achieve this year.",              hint: "Why is it important to you?",      tag: "advanced-opinion" },
  { emoji: "🌍", title: "If you could visit any country, where would you go and why?", hint: "Two reasons.",                     tag: "advanced-opinion" }
];
 
app.post("/echo/prompt", (req, res) => {
  try {
    const { recent = [] } = req.body || {};
    const avoid = new Set(Array.isArray(recent) ? recent.slice(-30) : []);
    const pool = ECHO_PROMPTS.filter(p => !avoid.has(p.title));
    const list = pool.length > 0 ? pool : ECHO_PROMPTS;
    const pick = list[Math.floor(Math.random() * list.length)];
    res.json({
      id: `echo-${Math.random().toString(36).slice(2, 9)}`,
      emoji: pick.emoji,
      title: pick.title,
      hint: pick.hint,
      tag: pick.tag
    });
  } catch (error) {
    console.error("echo/prompt error:", error);
    res.status(500).json({ error: "echo prompt error" });
  }
});
 
// Whisper transcription of a user's raw recording.
// Accepts multipart form-data with one field: "audio" (m4a/wav/mp3/webm).
app.post("/echo/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ error: "Missing audio" });
    }
 
    const filename     = (req.file.originalname || "recording.m4a").replace(/[^\w.\-]/g, "_");
    const contentType  = req.file.mimetype || "audio/mp4";
 
    // Build multipart body for OpenAI's audio/transcriptions endpoint.
    const boundary = "----LangooEcho" + Math.random().toString(36).slice(2);
    const parts = [];
    const push = (s) => parts.push(Buffer.from(s, "utf8"));
 
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="model"\r\n\r\n`);
    push(`gpt-4o-mini-transcribe\r\n`);
 
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="response_format"\r\n\r\n`);
    push(`json\r\n`);
 
    // Language auto-detect. We assume the user spoke English (learning target),
    // but we pass no "language" to let the model detect gracefully.
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="temperature"\r\n\r\n`);
    push(`0\r\n`);
 
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`);
    push(`Content-Type: ${contentType}\r\n\r\n`);
    parts.push(req.file.buffer);
    push(`\r\n--${boundary}--\r\n`);
 
    const body = Buffer.concat(parts);
 
    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length
      },
      body
    });
 
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      console.error("echo/transcribe upstream error:", upstream.status, errText);
      return res.status(502).json({ error: "transcription upstream error" });
    }
 
    const data = await upstream.json();
    const transcript = (data?.text || "").trim();
 
    res.json({
      transcript,
      duration_sec: data?.duration || null,
      language:     data?.language || null
    });
  } catch (error) {
    console.error("echo/transcribe error:", error);
    res.status(500).json({ error: "transcription error" });
  }
});
 
// Core AI rewrite: takes the user's raw English and returns:
//   - rewritten: a polished, native-sounding version preserving meaning + tone
//   - improvements: up to 8 word/phrase upgrades (before → after + reason)
//   - scores: fluency / vocab / grammar / flow / confidence (0-100 each)
//   - headline: one-line reaction in the user's native language
//   - tags: quick badges the client can display ("3 phrasal verbs added", etc.)
app.post("/echo/rewrite", async (req, res) => {
  try {
    const {
      transcript      = "",
      tone            = "natural",
      native_language = "fr",
      prompt_title    = "",
      prompt_hint     = ""
    } = req.body || {};
 
    const cleaned = (transcript || "").trim();
    if (!cleaned) {
      return res.status(400).json({ error: "Missing transcript" });
    }
 
    const nativeLang = getLanguageName(native_language);
 
    const toneLabel = (() => {
      switch ((tone || "").toLowerCase()) {
        case "casual":        return "relaxed, friendly, everyday spoken English with contractions and natural fillers";
        case "confident":     return "assertive, clear, direct — the way a native speaker sounds when sure of themselves";
        case "professional":  return "polished, polite, business-appropriate without sounding stiff";
        case "poetic":        return "lyrical, rhythmic, slightly literary — still completely natural";
        case "funny":         return "witty, sharp, with well-placed comedic timing — never try-hard";
        default:              return "natural native English — relaxed, warm, effortless";
      }
    })();
 
    const promptBlock = prompt_title
      ? `\nSITUATIONAL PROMPT THE USER WAS ANSWERING:\n- Task: "${String(prompt_title).replace(/"/g, "'")}"\n- Hint: "${String(prompt_hint || "").replace(/"/g, "'")}"\n\nThe user's transcript MUST be evaluated as an answer to that specific situation.\nIf the user answered off-topic (e.g. the task was "Ask the taxi how much you owe" but they talked about their weekend), their CONTENT score must be severely penalized (under 40/100 for fluency and flow) — even if their English was otherwise clean. Reflect this in the headline and improvements too.\n`
      : "";
 
    const system =
`You are the flagship AI coach of a language-learning app called Langoo.
 
The exercise is called ECHO. A non-native speaker is given an English task (usually a real-world situational roleplay — "At the hotel, ask for a room", "At the restaurant, ask for the bill" — or a simple opinion question) and records themselves answering it out loud. You receive their raw speech-to-text transcript.${promptBlock}
 
You do TWO things at once:
(A) UPGRADE their transcript into the English version a NATIVE speaker would have actually said in that exact situation — preserving meaning, personality and emotion.
(B) STRICTLY SCORE their performance on THREE things: content appropriateness to the situation, English correctness, and phonetic clarity (inferred from how clean the transcript came out — garbled, partial, or fragmented transcripts are strong signals of weak pronunciation and MUST lower the "confidence" and "fluency" scores).
 
Target style for the rewrite: ${toneLabel}.
 
VOCABULARY LEVEL — CRITICAL:
- The user is roughly B1 (intermediate). They must UNDERSTAND your rewrite.
- Prefer the 2000 most common English words. Short sentences. Clear rhythm.
- Avoid rare vocabulary, literary words, uncommon idioms, or multi-layered metaphors unless absolutely necessary.
- If you must use a less common native expression, choose only ONE per rewrite and keep the rest simple.
- If the user spoke very simply, keep your rewrite simple too.
 
STRICT JSON OUTPUT (no markdown, no commentary). Shape:
{
  "rewritten": "the polished native-English version, rewritten so it actually answers the situational prompt. Same length as the user +/- 20%. Accessible B1 vocabulary.",
  "translation": "a faithful, natural translation of 'rewritten' into ${nativeLang}.",
  "transcript_translation": "a faithful, natural translation of the user's original transcript into ${nativeLang}.",
  "headline": "one short, warm, encouraging sentence in ${nativeLang} (max 18 words). If they went off-topic, say so kindly.",
  "improvements": [
    {
      "before": "exact user word or short phrase (2-5 words max) that needed work",
      "after":  "what a native would say instead",
      "reason": "a super short reason in ${nativeLang} (max 10 words)"
    }
  ],
  "scores": {
    "fluency":     0-100,
    "vocabulary":  0-100,
    "grammar":     0-100,
    "flow":        0-100,
    "confidence":  0-100
  },
  "tags": [
    "short highlights in ${nativeLang}, max 4 tags, max 5 words each"
  ]
}
 
SCORING RUBRIC — BE STRICT:
- fluency     = answers the situational task naturally and without long pauses or broken syntax.
- vocabulary  = words chosen are appropriate for the situation (e.g. "check in", "reservation", "the bill").
- grammar     = tense/agreement/articles correctness.
- flow        = logical sequence — greeting, request, detail, closing — fits the situation.
- confidence  = phonetic / pronunciation clarity inferred from the transcript: clean = high, partial/garbled/missing words = LOW.
- A native speaker who answers the exact task gets 92-100.
- A learner who answers the task with some grammar/accent issues gets 55-80.
- A learner who clearly answered a DIFFERENT topic gets below 40 on fluency AND flow, regardless of their English.
- A mostly unintelligible transcript gets confidence and fluency below 45.
 
OTHER RULES:
- rewritten MUST naturally answer the situational prompt in native English.
- translation and transcript_translation must be in ${nativeLang}.
- Do NOT invent facts. If the user is ambiguous, stay ambiguous.
- improvements: 3 to 8 items. Include at least one pronunciation/liaison note if the transcript shows broken or phonetically garbled English.
- If the transcript is near-perfect, return an empty improvements array and keep scores 90+.
- headline: warm. Like a best friend hyping them up, in ${nativeLang}.
- Never shame. Never mock. Be specific.`;
 
    const user =
`USER TRANSCRIPT (raw, as recognized by speech-to-text):
"""
${cleaned}
"""
 
Upgrade it now. Return STRICT JSON only.`;
 
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.6,
        top_p: 0.95,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user }
        ]
      })
    });
 
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("echo/rewrite upstream error:", response.status, errText);
      return res.status(502).json({ error: "rewrite upstream error" });
    }
 
    const data = await response.json();
    const raw  = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
 
    // Sanitize scores: integers 0-100
    const clampScore = (v) => {
      const n = Math.round(Number(v));
      if (isNaN(n)) return 0;
      return Math.max(0, Math.min(100, n));
    };
    const sIn = parsed.scores || {};
    const scores = {
      fluency:    clampScore(sIn.fluency),
      vocabulary: clampScore(sIn.vocabulary),
      grammar:    clampScore(sIn.grammar),
      flow:       clampScore(sIn.flow),
      confidence: clampScore(sIn.confidence)
    };
    const overall = Math.round(
      (scores.fluency * 0.32) +
      (scores.vocabulary * 0.20) +
      (scores.grammar * 0.20) +
      (scores.flow * 0.16) +
      (scores.confidence * 0.12)
    );
 
    const cleanStr = (v) => typeof v === "string" ? v.trim() : "";
    const arrStr = (a, max) => Array.isArray(a)
      ? a.map(cleanStr).filter(x => x.length > 0).slice(0, max)
      : [];
 
    const improvements = Array.isArray(parsed.improvements)
      ? parsed.improvements.map(it => ({
          before: cleanStr(it?.before),
          after:  cleanStr(it?.after),
          reason: cleanStr(it?.reason)
        })).filter(it => it.before && it.after).slice(0, 8)
      : [];
 
    res.json({
      rewritten:    cleanStr(parsed.rewritten)  || cleaned,
      headline:     cleanStr(parsed.headline)   || "",
      improvements,
      scores,
      overall,
      tags:         arrStr(parsed.tags, 4),
      words_before: cleaned.split(/\s+/).filter(Boolean).length,
      words_after:  (cleanStr(parsed.rewritten) || cleaned).split(/\s+/).filter(Boolean).length,
      translation:            cleanStr(parsed.translation) || null,
      transcript_translation: cleanStr(parsed.transcript_translation) || null
    });
  } catch (error) {
    console.error("echo/rewrite error:", error);
    res.status(500).json({ error: "rewrite error" });
  }
});
 
// TTS for the rewritten text. Reuses gpt-4o-mini-tts with a warmer, more
// storytelling-style instruction than the pronunciation endpoint.
app.post("/echo/speak", async (req, res) => {
  try {
    const { text = "", voice = "shimmer" } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }
 
    const allowed = new Set([
      "nova", "shimmer", "alloy", "sage", "verse", "coral", "ash", "ballad", "echo", "fable", "onyx"
    ]);
    // Default to a warmer, calmer, more human voice (shimmer). "nova" is
    // slightly bright and "sells"-y for some ears; shimmer is quieter.
    const voiceSafe = allowed.has(voice) ? voice : "shimmer";
 
    const instructions =
`Voice: warm, human, soft-spoken. Like a calm friend explaining something patiently on a phone call.
Pacing: slow, unhurried, with small real breaths between clauses. Never rushed.
Intonation: natural, gentle rise and fall. Understated emotion, never theatrical.
Tone: grounded, honest, reassuring. Sound like a real person — never like a podcast host.
Neutral American English. Crisp but unforced articulation. No energy bursts. No salesy brightness.
This is a correction played back to a language learner — it should feel kind and easy to understand.`;
 
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voiceSafe,
        input: text,
        instructions,
        format: "mp3"
      })
    });
 
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      console.error("echo/speak upstream error:", upstream.status, errText);
      return res.status(502).json({ error: "tts upstream error" });
    }
 
    const arrayBuf = await upstream.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.send(buf);
  } catch (error) {
    console.error("echo/speak error:", error);
    res.status(500).json({ error: "echo tts error" });
  }
});
 
// ===============================
// /translate/simple — on-demand, cached, tiny translation helper used
// by the ECHO and Fill-the-Blanks exercises to show a "Translation"
// dropdown in the user's native language. Lightweight, fast, and safe.
// ===============================
app.post("/translate/simple", async (req, res) => {
  try {
    const { text = "", target_language = "fr" } = req.body || {};
    const cleaned = (text || "").trim();
    if (!cleaned) return res.status(400).json({ error: "Missing text" });
    if (cleaned.length > 600) {
      return res.status(400).json({ error: "Text too long" });
    }
 
    const targetName = getLanguageName(target_language);
 
    const system =
`You are a translation engine for a language-learning app.
Translate the user's English sentence into ${targetName}.
Rules:
- The translation must be natural, simple, and clear to a native speaker of ${targetName}.
- Preserve meaning and tone exactly.
- Return ONLY the translated sentence — no explanation, no quotes, no labels.
- If the input is already in ${targetName}, return it unchanged.`;
 
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user",   content: cleaned }
        ]
      })
    });
 
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("translate/simple upstream error:", response.status, errText);
      return res.status(502).json({ error: "translate upstream error" });
    }
 
    const data = await response.json();
    const translation = (data?.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
    res.json({ translation });
  } catch (error) {
    console.error("translate/simple error:", error);
    res.status(500).json({ error: "translate error" });
  }
});
 
// ===============================
// REALTIME WEB PAGE (existing, model aligned)
// ===============================
app.get("/realtime-client", (req, res) => {
  const nativeLanguage = req.query.native_language || "fr";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { background:#16163A; color:white; font-family:sans-serif; padding:16px; }
button { width:100%; padding:16px; margin-bottom:10px; font-size:18px; }
</style>
</head>
<body>
<h2>Real Talk Live</h2>
<button onclick="connect()">Connect live voice</button>
<button onclick="disconnect()">Disconnect</button>
<p id="status">Idle</p>
<p><b>You:</b> <span id="you"></span></p>
<p><b>AI:</b> <span id="ai"></span></p>
<script>
let pc;
async function connect() {
  document.getElementById("status").textContent = "Connecting...";
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const tokenRes = await fetch('/realtime/token?native_language=${nativeLanguage}');
  const tokenData = await tokenRes.json();
  const key = tokenData.client_secret.value;
  pc = new RTCPeerConnection();
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  const dc = pc.createDataChannel("oai-events");
  dc.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === "response.audio_transcript.delta") document.getElementById("ai").textContent += msg.delta;
    if (msg.type === "conversation.item.input_audio_transcription.completed") document.getElementById("you").textContent = msg.transcript;
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdpRes = await fetch("https://api.openai.com/v1/realtime?model=gpt-realtime", {
    method: "POST", body: offer.sdp,
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/sdp" }
  });
  await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
  document.getElementById("status").textContent = "Connected";
}
function disconnect() {
  if (pc) { pc.close(); pc = null; }
  document.getElementById("status").textContent = "Disconnected";
}
</script>
</body>
</html>`);
});
 
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
