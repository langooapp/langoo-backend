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
            content:
              "You generate simple English learning content. Return exactly 3 lines. Each line must follow this format: English sentence - Translation."
          },
          {
            role: "user",
            content: message
          }
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
        return {
          text: (parts[0] || "").trim(),
          translation: parts.slice(1).join(" - ").trim()
        };
      });

    res.json({ result: JSON.stringify(sentences) });

  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// REALTIME TOKEN
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
    default: return "Unknown";
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
            output: { voice: "marin" },
            input: {
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: 450,
                threshold: 0.5,
                create_response: true
              }
            }
          },
          instructions: `You are a friendly English conversation partner.
The user's native language is ${nativeLanguage}.
Speak naturally and keep answers short and conversational.`
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
// REALTIME WEB PAGE (CRUCIAL FIX)
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

    if (msg.type === "response.audio_transcript.delta") {
      document.getElementById("ai").textContent += msg.delta;
    }

    if (msg.type === "conversation.item.input_audio_transcription.completed") {
      document.getElementById("you").textContent = msg.transcript;
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch("https://api.openai.com/v1/realtime?model=gpt-realtime", {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/sdp"
    }
  });

  const answer = {
    type: "answer",
    sdp: await sdpRes.text()
  };

  await pc.setRemoteDescription(answer);

  document.getElementById("status").textContent = "Connected";
}

function disconnect() {
  if (pc) {
    pc.close();
    pc = null;
  }
  document.getElementById("status").textContent = "Disconnected";
}
</script>

</body>
</html>`);
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
