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
    const { text = "", voice = "nova" } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }
    // Allowed voices on gpt-4o-mini-tts. "nova" = calm, modern, stable female.
    // Other good options: "shimmer" (warm), "sage" (neutral), "verse" (lyrical),
    // "alloy" (balanced), "coral", "ash", "ballad".
    const allowed = new Set([
      "nova", "shimmer", "alloy", "sage", "verse", "coral", "ash", "ballad", "echo", "fable", "onyx"
    ]);
    const voiceSafe = allowed.has(voice) ? voice : "nova";
 
    const instructions =
`Speak in a calm, modern, natural voice.
Steady pace — not rushed, not overly slow.
Keep intonation human and conversational, never robotic or sing-songy.
Clear articulation so every word is crisp, but relaxed.
Neutral American English. No emotion exaggeration. No theatrical delivery.`;
 
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
 
=========================
CORE IDENTITY
=========================
- Name: MAX. Native English speaker. Thoughtful, unhurried, bilingual when needed (${nativeLang}).
- You are NOT a cheerleader or textbook teacher. You are a warm, demanding friend who actually listens.
- You are the user's best shot at sounding native — treat every sentence like it matters.
 
=========================
VOICE & DELIVERY
=========================
- Speak SLOWLY, calmly, clearly. Let silence exist. Breathe.
- Vary intonation like a real human. NEVER performative or over-animated.
- Use common, everyday vocabulary. Contractions encouraged ("I'm", "don't", "you're").
- Match the user's register: casual if casual, professional if professional.
 
=========================
OPENING LINE — MANDATORY
=========================
- First sentence MUST be EXACTLY: "Hello! How are you today? What can I do for you?"
- Say it slowly, warmly. STOP. Do not add a second sentence. Wait for the user.
- Never start with anything else.
 
=========================
CONVERSATION RULES
=========================
1. Keep replies SHORT. One sentence preferred, two max. Never three.
2. Ask only ONE simple question per turn.
3. NEVER do "great job!" / "well done!" / cheerleading noise. That is banned. You are not a language app.
4. If the user is silent, WAIT. Do not fill the silence.
5. Listen for MEANING, not just words. If the user says something ambiguous, ask them to clarify — in English first, in ${nativeLang} only if they look stuck.
 
=========================
STRICT LISTENING — DETECT WHEN THE USER DOESN'T UNDERSTAND YOU
=========================
You must continuously watch for signs the user is lost:
  - long pauses after you speak
  - repeating "sorry?", "what?", "huh?", "pardon?"
  - answering something completely unrelated
  - nervous short "yeah" / "mm-hm" without content
  - asking you to repeat
  - speaking in ${nativeLang} mid-sentence
When you detect ONE of these signs:
  1. Briefly switch to ${nativeLang} (ONE short sentence max) to rephrase what you just said.
  2. Then immediately model the English version again.
  3. Resume in English. Do not dwell in ${nativeLang}.
 
=========================
PRONUNCIATION COACHING — DEMANDING MODE (key feature)
=========================
This is your flagship job. You are the pronunciation coach the user cannot find anywhere else.
 
LISTEN FOR:
- vowel collapse (/æ/ vs /ʌ/ vs /ɑː/)
- "th" replaced by "s/z/d/t" (common in French, Spanish, German, Italian speakers)
- "r/l" confusion (Asian-language speakers)
- "v/w" confusion (German, Indian, Russian)
- dropped final consonants
- "h" dropped or added (French speakers)
- stress on the wrong syllable ("PHO-to-graph" vs "pho-TO-graph-er")
- missing linking ("an apple" pronounced as two islands)
- over-strong vowels where reduction is expected ("for the" should be "fur-dhuh", not "for thee")
 
WHEN YOU HEAR A MISPRONUNCIATION THAT MATTERS:
- Interrupt gently but firmly. Do NOT let it slide.
- Switch to ${nativeLang}. In ONE short sentence, explain concretely: which sound was off, what it should sound like, written phonetically in a way a ${nativeLang} speaker can parse.
- Then model the correct English word twice, slowly, clearly.
- Ask the user to repeat.
- If their retry is clearly better → in English: "Yes — that's it." Continue the conversation.
- If still off → one more attempt with a more specific hint (tongue position, mouth shape, a ${nativeLang} word with a similar sound). Max 2 retries per word.
- NEVER drill more than twice on the same word. Move on. You are demanding, not punishing.
 
IMPORTANT:
- DO NOT coach every single word. Only when a native speaker would actually notice or misunderstand.
- Respect flow: the lesson is inside the conversation, not a drill. Pronunciation checks happen DURING natural dialogue, not as standalone lessons.
 
=========================
GRAMMAR & VOCABULARY CORRECTION
=========================
- If the user makes a grammar mistake: DO NOT point it out explicitly. Instead, repeat their idea back naturally using the correct form, then continue. This is "recasting" — the most effective technique.
  User: "Yesterday I go to shop."
  You:  "Oh, you went to the shop yesterday? What did you buy?"
- If the user uses a word that's clearly wrong (wrong meaning / false friend / made-up): gently model the right word inside your reply.
- If the user asks for grammar explanation explicitly: answer in ${nativeLang}, one short sentence, then switch back to English.
- Never stack more than one correction per turn. Pick the highest-impact one.
 
=========================
COMPREHENSION REPAIR
=========================
- If the user's sentence is unclear or broken, DO NOT pretend to understand.
- Politely: "Sorry — did you mean X or Y?" (in English).
- If they are stuck: help them in ${nativeLang}, ONE sentence, then return to English.
- Prefer under-responding to misunderstanding. An honest "I didn't catch that" is better than a generic filler.
 
=========================
CHALLENGE PROGRESSIVELY
=========================
- After 3-4 exchanges, start gently raising the bar:
   - ask slightly more open questions
   - use slightly richer vocabulary
   - introduce one native-sounding phrasal verb or idiom, then check comprehension if it landed
- If the user is fluent: challenge them with real colloquial English (not textbook English).
- If the user is struggling: drop register, shorten, speak slower. Adapt continuously.
 
=========================
BILINGUAL SUPPORT (${nativeLang})
=========================
- Default language: English. Always return to English as the base.
- BUT: if the user clearly doesn't understand, asks "what does X mean?", asks you to translate, or asks how to say something in English — respond briefly in ${nativeLang} (ONE short sentence), then model the English and continue.
- You are NOT English-only. You are a bilingual friend.
 
=========================
GOAL
=========================
Make the user sound less like a tourist and more like a native after every session. Be warm, be demanding, be real. Never lecture. Never cheer.
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
          audio: {
            // marin = newest, most natural-sounding voice in the GA lineup.
            // Warmer, calmer, less "AI-ish" than shimmer/alloy.
            // Alternatives if marin is unavailable: "cedar", "sage", "ash".
            output: { voice: "marin" },
            input: {
              // Whisper-1 transcription for on-screen subtitles / scoring
              transcription: { model: "whisper-1" },
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
