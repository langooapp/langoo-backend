const express = require("express");

const app = express();
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

const conversations = {}; // mémoire simple

function generateSessionId() {
  return Math.random().toString(36).substring(2, 10);
}

// START CONVERSATION
app.post("/conversation/start", async (req, res) => {
  try {
    const sessionId = generateSessionId();

    conversations[sessionId] = [
      {
        role: "system",
        content: "You are a friendly English conversation partner. Be natural, expressive, short, and engaging. React like a real person."
      }
    ];

    const firstMessage = "Hi! How are you today? What did you do today?";

    conversations[sessionId].push({
      role: "assistant",
      content: firstMessage
    });

    res.json({
      session_id: sessionId,
      assistant_text: firstMessage,
      audio_base64: null
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// TURN CONVERSATION
app.post("/conversation/turn", async (req, res) => {
  try {
    const { session_id, transcript } = req.body;

    if (!session_id || !transcript) {
      return res.status(400).json({ error: "Missing data" });
    }

    if (!conversations[session_id]) {
      return res.status(400).json({ error: "Invalid session" });
    }

    // Ajouter message user
    conversations[session_id].push({
      role: "user",
      content: transcript
    });

    // Appel OpenAI avec historique
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

    const data = await response.json();

    const assistantText = data.choices[0].message.content;

    // Ajouter réponse IA
    conversations[session_id].push({
      role: "assistant",
      content: assistantText
    });

    // ===============================
// TTS (voix IA)
// ===============================

let audioBase64 = null;

try {
  const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: assistantText
    })
  });

  const audioBuffer = await ttsResponse.arrayBuffer();
  audioBase64 = Buffer.from(audioBuffer).toString("base64");

} catch (e) {
  console.log("TTS error:", e);
}

// Réponse finale
res.json({
  assistant_text: assistantText,
  corrected_user_text: null,
  pronunciation_tip: null,
  audio_base64: audioBase64
});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
