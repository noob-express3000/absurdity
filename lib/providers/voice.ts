export interface VoiceProvider {
  synthesize(text: string): Promise<ArrayBuffer>;
}

export class ElevenLabsVoiceProvider implements VoiceProvider {
  constructor(
    private apiKey = process.env.ELEVENLABS_API_KEY,
    private voiceId = process.env.ELEVENLABS_VOICE_ID,
  ) {}

  available() {
    return Boolean(this.apiKey && this.voiceId);
  }

  async synthesize(text: string) {
    if (!this.apiKey || !this.voiceId) {
      throw new Error("ElevenLabs is not configured.");
    }

    const response = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(this.voiceId),
      {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.48,
            similarity_boost: 0.74,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error("ElevenLabs request failed with status " + response.status);
    }

    return response.arrayBuffer();
  }
}
