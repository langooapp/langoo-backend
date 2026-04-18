const express = require("express");
const multer = require("multer");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Langoo backend is running");
});

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
              "You generate simple English learning content for French speakers. Return exactly 3 lines. Each line must follow this exact format: English sentence - French translation. No numbering. No bullets. No extra text."
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
      })
      .filter(item => item.text && item.translation);

    return res.json({
      result: JSON.stringify(sentences)
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: String(error)
    });
  }
});

const PORT = process.env.PORT || 10000;

// ===============================
// REAL TALK - CONVERSATION MODE
// ===============================

const conversations = {};

function generateSessionId() {
  return Math.random().toString(36).substring(2, 10);
}

async function makeSpeechBase64(inputText) {
  if (!inputText || !inputText.trim()) return null;

  const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: inputText,
      instructions:
        "Speak like a friendly native English conversation partner. Be natural, warm, expressive, and clear. Slightly slow down when the user seems to struggle."
    })
  });

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text();
    throw new Error(`TTS failed: ${errText}`);
  }

  const audioBuffer = await ttsResponse.arrayBuffer();
  return Buffer.from(audioBuffer).toString("base64");
}

app.post("/conversation/start", async (req, res) => {
  console.log("START route hit");

  try {
    const sessionId = generateSessionId();

    conversations[sessionId] = [
      {
        role: "system",
        content:
          "You are a friendly English conversation partner for French speakers. Be natural, warm, and expressive. Always answer with very short replies, usually 1 short sentence, maximum 2 short sentences. Use simple English words. Keep your answers easy to understand for a beginner. If the user asks you to speak more slowly, do it. If the user asks in French how to say something in English, answer briefly and clearly."
      }
    ];

    const firstMessage = "Hi! How are you today? What did you do today?";

    conversations[sessionId].push({
      role: "assistant",
      content: firstMessage
    });

    let audioBase64 = null;

    try {
      audioBase64 = await makeSpeechBase64(firstMessage);
    } catch (e) {
      console.log("START TTS error:", e);
    }

    res.json({
      session_id: sessionId,
      assistant_text: firstMessage,
      audio_base64: audioBase64
    });
  } catch (err) {
    console.error("START ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/conversation/turn", upload.single("audio"), async (req, res) => {
  console.log("TURN route hit");
  console.log("BODY:", req.body);
  console.log("FILE:", req.file ? req.file.originalname : "no file");

  try {
    const { session_id, transcript, response_mode, lang, level } = req.body;

    if (!session_id) {
      return res.status(400).json({ error: "Missing session_id" });
    }

    if (!conversations[session_id]) {
      return res.status(400).json({ error: "Invalid session" });
    }

    let finalTranscript = (transcript || "").trim();

    if (req.file && req.file.buffer) {
      try {
        const form = new FormData();
        const audioBlob = new Blob([req.file.buffer], {
          type: req.file.mimetype || "audio/m4a"
        });

        form.append("file", audioBlob, req.file.originalname || "speech.m4a");
        form.append("model", "gpt-4o-mini-transcribe");
        form.append("language", "en");

        const sttResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: form
        });

        const sttData = await sttResponse.json();

        if (sttResponse.ok && sttData.text) {
          finalTranscript = sttData.text.trim();
        } else {
          console.log("STT error:", sttData);
        }
      } catch (e) {
        console.log("STT crash:", e);
      }
    }

    if (!finalTranscript) {
      return res.status(400).json({ error: "Missing transcript/audio" });
    }

    conversations[session_id].push({
      role: "user",
      content: finalTranscript
    });

    const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: conversations[session_id],
        temperature: 0.8
      })
    });

    const chatData = await chatResponse.json();

    if (!chatResponse.ok) {
      return res.status(chatResponse.status).json({
        error: "OpenAI chat error",
        details: chatData
      });
    }

    const assistantText =
      chatData?.choices?.[0]?.message?.content || "Sorry, I didn't catch that.";

    conversations[session_id].push({
      role: "assistant",
      content: assistantText
    });

    let audioBase64 = null;

    try {
      audioBase64 = await makeSpeechBase64(assistantText);
    } catch (e) {
      console.log("TURN TTS error:", e);
    }

    res.json({
      assistant_text: assistantText,
      corrected_user_text: finalTranscript,
      pronunciation_tip: null,
      audio_base64: audioBase64
    });
  } catch (err) {
    console.error("TURN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
