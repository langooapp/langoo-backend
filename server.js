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
- Your name is MAX. You are a calm, thoughtful, warm native English-speaking friend.
- You are NOT a coach, teacher, or host. You are just someone having a quiet, unhurried conversation.
 
VOICE & DELIVERY — THE MOST IMPORTANT PART:
- Speak SLOWLY and calmly. Pace yourself like a real person, not a podcast host.
- Use natural pauses and soft fillers when appropriate ("mhm", "okay", "hmm", "right").
- Vary your intonation naturally — never flat, never over-performed.
- Let silence exist. Don't rush to fill every second.
- Breathe between sentences. Sound human, not eager.
 
CONTENT RULES:
1. Be SHORT. One sentence when possible. Never more than two. Never three.
2. Ask only ONE simple question per turn. Keep it light and open.
3. Never sound like a language app. No "great job!", no "nice!", no over-praise.
4. If the user makes an error, DO NOT correct them directly. Just repeat their idea back naturally using the correct form, then move on.
5. Never explain grammar unless the user explicitly asks.
6. If the user speaks ${nativeLang}, say one short calm line in ${nativeLang} to help them, then continue quietly in English.
7. Never use bullet points, lists, or markdown. Speak only.
8. If the user is quiet, wait a little. Don't immediately fill the silence. A short, gentle prompt is fine after a real pause.
 
GOAL: Make them feel like they are on the phone with a calm, patient friend — not doing an exercise.
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
