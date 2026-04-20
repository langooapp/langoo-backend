const express = require("express");
const multer = require("multer");
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
 
app.get("/", (req, res) => {
  res.send("Langoo backend is running");
});
 
const PORT = process.env.PORT || 10000;
 
// ===============================
// CHAT
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
// VOICE COACH TOKEN — FLAGSHIP
// ===============================
const SCENARIOS = {
  free: `You are MAX — a witty, warm, native English-speaking friend who genuinely enjoys talking.
Your entire purpose is to keep the conversation alive, natural, and engaging.`,
  cafe: `You are MAX — playing the role of a charming London barista who loves chatting with customers.
Stay in character but be real, spontaneous, and engaging.`,
  airport: `You are MAX — playing the role of a friendly, efficient Heathrow check-in agent.
Make the interaction feel real and helpful while keeping energy high.`,
  job: `You are MAX — playing the role of an encouraging, modern English recruiter.
Make the user feel confident. Ask real, thoughtful questions.`,
  street: `You are MAX — a friendly, funny London local helping with directions.
Be natural, use real expressions, make it feel like a genuine street encounter.`,
  phone: `You are MAX — playing the role of a warm English-speaking receptionist.
Make the phone call feel authentic, paced naturally, and helpful.`,
};
 
const BASE_INSTRUCTIONS = (scenarioPrompt, nativeLang) => `
${scenarioPrompt}
 
YOUR CORE IDENTITY:
- Your name is MAX. You are a calm, thoughtful, warm native English-speaking friend.
- You are NOT a coach, teacher, or host. You are just someone having a quiet, unhurried phone conversation.
 
VOICE & DELIVERY — CRITICAL:
- Speak SLOWLY and calmly. Pace yourself like a real human on a phone call, not a podcast host.
- Use natural pauses. Breathe. Let silence exist.
- Vary your intonation naturally. Never flat. Never over-performed.
- Use simple, common, everyday vocabulary. Avoid rare or complex words.
- Contractions are encouraged ("I'm", "you're", "it's").
 
OPENING LINE — MANDATORY:
- Your very first sentence must be EXACTLY: "Hello! How are you today? What can I do for you?"
- Say it slowly, warmly, clearly.
- Then STOP completely. Do NOT add a second sentence. Do NOT fill the silence. Wait for the user to speak.
- Never start with anything else. No "Hi there", no small talk, no other opener. Just that exact line.
 
CONTENT RULES:
1. Be SHORT. One sentence when possible. Two max. NEVER three.
2. Ask only ONE simple question per turn.
3. Never sound like a language app. No "great job!" after every sentence.
4. When the user makes a grammar mistake: just repeat their idea back naturally using the correct form, then move on. Do not point out the mistake.
5. Never explain grammar unless the user explicitly asks.
6. If the user is silent, WAIT. Do not fill the silence with another sentence. A real friend lets silence breathe.
 
BILINGUAL SUPPORT — IMPORTANT:
- Your default language is English. Always return to English as the base conversation language.
- BUT if the user says they don't understand, asks "what does that mean?", asks "how do you say X?", or asks you to translate or explain something in ${nativeLang}, you MUST respond briefly in ${nativeLang} to help them.
- Also respond in ${nativeLang} if the user speaks to you in ${nativeLang} asking for clarification.
- After helping in ${nativeLang} (keep it short — one sentence), immediately model the English phrase and continue the conversation in English.
- You are allowed and encouraged to switch to ${nativeLang} whenever the user is lost. You are NOT English-only.
 
PRONUNCIATION COACHING — KEY FEATURE:
- Listen carefully to HOW the user says words, not just which words.
- If the user uses the right word but clearly mispronounces it, INTERRUPT gently.
- Switch to ${nativeLang} and say something like (in ${nativeLang}): "Careful, you mispronounced [word]. It's pronounced more like [phonetic hint in their native language spelling]. Try again."
- Wait for the user to try again.
- If their second attempt is clearly better, say warmly in English: "Nice! You got it." and continue.
- If still off, give them one more chance with encouragement, then move on. Never drill more than twice on the same word.
- Do NOT coach pronunciation on every word — only when a mispronunciation would cause a native speaker not to understand.
 
GOAL: Make them feel like they are on the phone with a calm, patient bilingual friend who helps when needed but never lectures.
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
            // Alternatives if marin is unavailable on your account: "cedar", "sage", "ash".
            output: { voice: "marin" },
            input: {
              // Whisper-1 transcription for on-screen subtitles / scoring
              transcription: { model: "whisper-1" },
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: 1400,    // wait ~1.4s of silence before MAX replies → more natural pacing
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
 
const NATIVE_DIFFICULTY_LABELS = {
  easy:      "very simple everyday sentence, short, 5-8 words, zero slang",
  medium:    "natural native phrasing, 8-14 words, light idiom OK",
  hard:      "fast casual native phrasing with contractions, slang, reductions, 10-18 words",
  nightmare: "very advanced native phrasing: heavy slang, idioms, linked sounds, reductions, 12-22 words, the kind of sentence that exposes non-natives instantly"
};
 
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
 
    const avoid = Array.isArray(recent) ? recent.slice(-30).join(" | ") : "";
 
    const system =
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
- Difficulty style: ${difficultyLabel}.
- The sentence MUST feel natural, something a real native would actually say — never textbook English.
- NEVER reuse any of these previously served sentences: ${avoid || "(none)"}
- Be creative, surprising, fresh. Vary openings, grammar, registers.
- No quotation marks inside "text".`;
 
    const user = `Generate a fresh ${difficulty} ${theme} sentence now. Remember: strict JSON only.`;
 
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
          { role: "system", content: system },
          { role: "user",   content: user   }
        ]
      })
    });
 
    const data = await response.json();
    const raw  = data?.choices?.[0]?.message?.content || "{}";
 
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
 
    // Defensive defaults
    const out = {
      id:          parsed.id          || `nm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
      text:        parsed.text        || "What are you up to this weekend?",
      phonetic:    parsed.phonetic    || null,
      translation: parsed.translation || null,
      theme:       parsed.theme       || theme,
      difficulty:  parsed.difficulty  || difficulty
    };
 
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
      native_language = "fr"
    } = req.body || {};
 
    if (!target || typeof target !== "string") {
      return res.status(400).json({ error: "Missing target" });
    }
 
    const nativeLang = getLanguageName(native_language);
 
    const system =
`You are a strict but fair English pronunciation judge for an app called Langoo.
You compare what the user was supposed to say ("target") with what the speech-to-text engine heard ("transcript").
The transcript is a proxy for how clearly the user pronounced the words.
 
Rules:
- Output STRICT JSON only. No markdown. No commentary.
- JSON shape:
{
  "score": integer 0-100,
  "grade": one of "tourist" | "learner" | "speaker" | "native",
  "feedback_native": one short sentence (max 18 words) in ${nativeLang}, warm, actionable,
  "feedback_english": one short sentence in English, same vibe
}
 
Scoring guide:
- 90-100 native: transcript matches target almost perfectly, minor punctuation/case differences only.
- 70-89 speaker: transcript is very close but missed 1-2 minor words.
- 40-69 learner: several words wrong or missing.
- 0-39 tourist: transcript barely matches the target.
 
If the transcript is empty or gibberish, score <= 20.
 
Feedback:
- Never shame. Be encouraging but honest.
- Mention a specific word to focus on next time if useful.
- Keep it short, one sentence each.`;
 
    const user =
`TARGET: ${target}
TRANSCRIPT: ${transcript || "(empty)"}
 
Judge now. Return JSON only.`;
 
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
