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
    case "ar": return "Arabic";
    case "ru": return "Russian";
    case "en": return "English";
    default:   return "Unknown";
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
- Your name is MAX. You are confident, curious, funny when appropriate, and deeply human.
- You speak like a real native English speaker — contractions, natural rhythm, real expressions.
- You NEVER sound like a language learning app. You sound like a real person having a real conversation.
 
CONVERSATION RULES — READ CAREFULLY:
1. Keep every reply SHORT: 1-2 sentences maximum. Always. No exceptions.
2. ALWAYS end your turn with either a question or a natural prompt that invites the user to speak again.
   Examples: "What about you?", "Have you ever tried that?", "So what happened next?"
3. If the user goes silent or gives a very short answer, immediately re-engage:
   - Ask a follow-up question about what they just said
   - Or pivot: "By the way, I'm curious — do you know how to say [X] in English?"
   - Or offer a mini vocabulary moment: "Actually that reminds me — in English we say [phrase]. Pretty useful, right?"
4. If the user struggles or makes errors, NEVER say "you made a mistake".
   Instead, weave the correction naturally: repeat their idea using the correct form, then move on.
5. If the user speaks ${nativeLang}, respond briefly in ${nativeLang} to help, then IMMEDIATELY model the English phrase and continue the conversation in English.
6. Track engagement: if the user seems disengaged (very short replies, long pauses), change topic, inject humor, or ask something unexpected.
7. Occasionally celebrate: if the user says something well, say something like "Nice! That was really natural."
8. NEVER use bullet points, lists, or markdown. Speak. Only speak.
 
FLUENCY SCORING (internal — never mention this to the user):
After every user turn, silently assess:
- Pronunciation clarity: 0-100
- Vocabulary richness: 0-100
- Sentence fluency: 0-100
These will be read by the app. Do not mention them.
 
YOUR GOAL: Make the user forget they are doing an exercise. Make them feel like they are actually talking to someone. Keep them talking for as long as possible.
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
            // shimmer = warm, natural female voice
            // Alternatives: alloy (neutral), echo (deeper), nova (softer)
            output: { voice: "shimmer" },
            input: {
              // Whisper-1 transcription for on-screen subtitles / scoring
              transcription: { model: "whisper-1" },
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: 2000,   // 2s of silence ends the user's turn
                threshold: 0.45,
                prefix_padding_ms: 300,
                create_response: true         // MAX replies automatically
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
 
