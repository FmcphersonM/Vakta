/** Tiny, dependency-free TwiML builders (unit-tested). */

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function attrs(a: Record<string, string | number | boolean | undefined | null>) {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");
}

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

export type VoiceConfig = {
  ttsProvider: string;
  voiceNb: string;
  voiceEn: string;
  sttProvider: string;
  sttModelNb?: string;
};

export function conversationRelayTwiml(opts: {
  wsUrl: string;
  actionUrl: string;
  welcomeGreeting: string;
  language: "nb" | "en";
  voice: VoiceConfig;
  hints: string[];
  record?: { statusCallback: string } | null;
  params: Record<string, string>;
}) {
  const nb = { code: "nb-NO", voice: opts.voice.voiceNb, speechModel: opts.voice.sttModelNb };
  const en = { code: "en-US", voice: opts.voice.voiceEn, speechModel: undefined };
  const main = opts.language === "en" ? en : nb;
  const other = opts.language === "en" ? nb : en;
  const recording = opts.record
    ? `<Start><Recording${attrs({ recordingStatusCallback: opts.record.statusCallback, recordingStatusCallbackEvent: "completed", channels: "dual", trim: "trim-silence" })}/></Start>`
    : "";
  const relay =
    `<ConversationRelay${attrs({
      url: opts.wsUrl,
      welcomeGreeting: opts.welcomeGreeting,
      // The opening carries the AI + recording notice: always heard in full.
      welcomeGreetingInterruptible: "none",
      language: main.code,
      ttsProvider: opts.voice.ttsProvider,
      voice: main.voice,
      transcriptionProvider: opts.voice.sttProvider,
      speechModel: main.speechModel,
      interruptible: "speech",
      dtmfDetection: true,
      hints: opts.hints.join(",").slice(0, 1000),
    })}>` +
    `<Language${attrs({ code: other.code, ttsProvider: opts.voice.ttsProvider, voice: other.voice, transcriptionProvider: opts.voice.sttProvider, speechModel: other.speechModel })}/>` +
    Object.entries(opts.params)
      .map(([name, value]) => `<Parameter${attrs({ name, value })}/>`)
      .join("") +
    `</ConversationRelay>`;
  return doc(`${recording}<Connect${attrs({ action: opts.actionUrl })}>${relay}</Connect>`);
}

// Short fixed messages (outside the AI conversation) use Amazon Polly neural voices via <Say>.
const sayVoice = (lang: "nb" | "en") => (lang === "en" ? { language: "en-GB", voice: "Polly.Amy-Neural" } : { language: "nb-NO", voice: "Polly.Ida-Neural" });

export function sayAndHangup(text: string, lang: "nb" | "en" = "nb") {
  return doc(`<Say${attrs(sayVoice(lang))}>${esc(text)}</Say><Hangup/>`);
}

export function dialTwiml(opts: { number: string; callerId: string; actionUrl: string; timeout?: number; say?: string; lang?: "nb" | "en" }) {
  const pre = opts.say ? `<Say${attrs(sayVoice(opts.lang ?? "nb"))}>${esc(opts.say)}</Say>` : "";
  return doc(
    `${pre}<Dial${attrs({ callerId: opts.callerId, timeout: opts.timeout ?? 25, action: opts.actionUrl, answerOnBridge: true })}><Number>${esc(opts.number)}</Number></Dial>`,
  );
}

export function redirectTwiml(url: string) {
  return doc(`<Redirect method="POST">${esc(url)}</Redirect>`);
}

export function rejectTwiml(reason: "busy" | "rejected" = "rejected") {
  return doc(`<Reject${attrs({ reason })}/>`);
}

export function hangupTwiml() {
  return doc(`<Hangup/>`);
}
