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
// CHAT (autre exercice)
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
              "You generate simple English learning content. Return exactly 3 lines. Each line must follow this format: English sentence - Translation. No extra text."
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

    if (!response.ok) {
      return res.status(response.status).json({
        error: "OpenAI error",
        details: data
      });
    }

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
    res.status(500).json({ error: "Server error", details: String(error) });
  }
});

// ===============================
// REAL TALK - CURRENT PIPELINE
// ===============================

const conversations = {};

function generateSessionId() {
  return Math.random().toString(36).substring(2, 10);
}

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

async function makeSpeechBase64(text) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: text
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS failed: ${errorText}`);
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

app.post("/conversation/start", async (req, res) => {
  try {
    const sessionId = generateSessionId();
    const { native_language } = req.body;
    const nativeLang = getLanguageName(native_language);

    conversations[sessionId] = [
      {
        role: "system",
        content: `You are a friendly English conversation partner.
The user's native language is ${nativeLang}.
Speak simply, naturally, and like a real person.
Always answer in 1 very short sentence, maximum 2 short sentences.
Use easy English words for beginners.
Do not give long explanations unless the user explicitly asks for them.`
      }
    ];

    const firstMessage = "Hi! How are you today?";

    conversations[sessionId].push({
      role: "assistant",
      content: firstMessage
    });

    const audio = await makeSpeechBase64(firstMessage);

    res.json({
      session_id: sessionId,
      assistant_text: firstMessage,
      audio_base64: audio
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/conversation/turn", upload.single("audio"), async (req, res) => {
  try {
    const { session_id, transcript } = req.body;

    if (!conversations[session_id]) {
      return res.status(400).json({ error: "Invalid session" });
    }

    let finalText = transcript;

    if (req.file) {
      const form = new FormData();
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });

      form.append("file", blob, "audio.m4a");
      form.append("model", "gpt-4o-mini-transcribe");

      const stt = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: form
      });

      const sttData = await stt.json();

      if (sttData.text) {
        finalText = sttData.text;
      }
    }

    conversations[session_id].push({
      role: "user",
      content: finalText
    });

    const chat = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: conversations[session_id],
        temperature: 0.4
      })
    });

    const chatData = await chat.json();

    if (!chat.ok) {
      return res.status(chat.status).json({
        error: "OpenAI chat error",
        details: chatData
      });
    }

    const reply = chatData?.choices?.[0]?.message?.content || "Sorry, I didn't catch that.";

    conversations[session_id].push({
      role: "assistant",
      content: reply
    });

    const audio = await makeSpeechBase64(reply);

    res.json({
      assistant_text: reply,
      corrected_user_text: finalText,
      pronunciation_tip: null,
      audio_base64: audio
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// REALTIME TOKEN ENDPOINT (OPTION A)
// ===============================

app.get("/realtime/token", async (req, res) => {
  try {
    const nativeLanguage = getLanguageName(req.query.native_language || "fr");

    const body = {
      expires_after: {
        anchor: "created_at",
        seconds: 7200
      },
      session: {
        type: "realtime",
        model: "gpt-realtime",
        audio: {
          output: {
            voice: "marin"
          },
          input: {
            noise_reduction: {
              type: "near_field"
            },
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: 450,
              prefix_padding_ms: 250,
              threshold: 0.5,
              create_response: true
            }
          }
        },
        instructions: `You are a friendly English conversation partner for language learners.
The user's native language is ${nativeLanguage}.
Speak naturally, warmly, and clearly.
Keep answers short and conversational.
Use beginner-friendly English unless the user clearly speaks at a higher level.
If the user asks how to say something in English, answer briefly and clearly.`
      }
    };

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Realtime token error",
        details: data
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to generate realtime token",
      details: String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
