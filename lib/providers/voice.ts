export interface VoiceProvider {
  synthesize(text: string): Promise<ArrayBuffer>;
}

export class NarrationError extends Error {
  constructor(public code: string, message: string, public providerStatus?: number) {
    super(providerStatus ? `${message} (HTTP ${providerStatus})` : message);
    this.name = "NarrationError";
  }
}

const providerErrors: Record<string, string> = {
  invalid_api_key: "ElevenLabs rejected the API key.",
  missing_permissions: "The ElevenLabs key needs Text to Speech permission.",
  voice_not_found: "ElevenLabs could not find the configured voice ID.",
  quota_exceeded: "ElevenLabs narration credits are exhausted.",
  insufficient_credits: "ElevenLabs narration credits are exhausted.",
  max_character_limit_exceeded: "The text exceeds the ElevenLabs request limit.",
  too_many_concurrent_requests: "ElevenLabs is handling too many narration requests. Try again shortly.",
  system_busy: "ElevenLabs is busy. Try again shortly.",
  paid_plan_required: "The configured ElevenLabs voice or feature requires a paid plan.",
  detected_unusual_activity: "ElevenLabs blocked this request under its account usage checks.",
};

export class ElevenLabsVoiceProvider implements VoiceProvider {
  constructor(
    private apiKey = process.env.ELEVENLABS_API_KEY?.trim(),
    private voiceId = process.env.ELEVENLABS_VOICE_ID?.trim(),
  ) {}

  available() {
    return Boolean(this.apiKey && this.voiceId);
  }

  async synthesize(text: string) {
    if (!this.apiKey || !this.voiceId) {
      throw new NarrationError("not_configured", !this.apiKey
        ? "Set ELEVENLABS_API_KEY in Render and redeploy."
        : "Set ELEVENLABS_VOICE_ID in Render and redeploy; the API key alone is not enough.");
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
      const body = await response.json().catch(() => null);
      const status = typeof body?.detail?.status === "string" ? body.detail.status : "";
      const code = Object.hasOwn(providerErrors, status) ? status : "provider_error";
      const message = providerErrors[code] || (response.status === 401
        ? "ElevenLabs rejected the API key or its permissions."
        : response.status === 403 ? "ElevenLabs denied access to this voice or feature."
        : "ElevenLabs could not generate narration.");
      // Never expose raw provider messages, request text or credentials.
      throw new NarrationError(code, message, response.status);
    }
    const audio = await response.arrayBuffer();
    if (!response.headers.get("content-type")?.startsWith("audio/") || !audio.byteLength) {
      throw new NarrationError("invalid_audio", "ElevenLabs returned no playable audio.");
    }
    return audio;
  }
}
