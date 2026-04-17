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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
