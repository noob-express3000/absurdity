import type { Story } from "../types";

export interface IntelligenceProvider {
  converse(message: string, stories: Story[], currentStoryId?: string): Promise<string>;
}

function extractResponseText(payload: any): string | null {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of parts) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      if (typeof chunk?.text === "string") return chunk.text;
    }
  }
  return null;
}

export class OpenAIIntelligenceProvider implements IntelligenceProvider {
  constructor(
    private apiKey = process.env.OPENAI_API_KEY,
    private model = process.env.OPENAI_MODEL || "gpt-5-mini",
  ) {}

  available() {
    return Boolean(this.apiKey);
  }

  async converse(message: string, stories: Story[], currentStoryId?: string) {
    if (!this.apiKey) throw new Error("OpenAI is not configured.");

    const compactCorpus = stories.map((story) => ({
      id: story.id,
      rank: story.rank,
      title: story.title,
      summary: story.summary,
      whyItsWeird: story.whyItsWeird,
      country: story.country,
      region: story.region,
      category: story.category,
      eventDate: story.eventDate,
      publicationDate: story.publicationDate,
      confidence: story.confidence,
      seriousness: story.seriousness,
      verificationNotes: story.verificationNotes,
      sources: story.sources,
      isFixture: story.isFixture,
    }));

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: 450,
        input:
          "You are Absurdity, an editorial briefing agent. Answer ONLY from the provided researched corpus. Never turn a seeded fixture into a live claim. Keep serious stories serious. If the corpus does not support the answer, say so. Current story id: " +
          (currentStoryId || "none") +
          "\n\nCORPUS:\n" +
          JSON.stringify(compactCorpus) +
          "\n\nUSER:\n" +
          message,
      }),
    });

    if (!response.ok) {
      throw new Error("OpenAI request failed with status " + response.status);
    }

    const payload = await response.json();
    const text = extractResponseText(payload);
    if (!text) throw new Error("OpenAI returned no text.");
    return text.trim();
  }
}
