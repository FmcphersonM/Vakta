import { describe, expect, it } from "vitest";
import { conversationRelayTwiml, dialTwiml, esc, sayAndHangup } from "@/lib/telephony/twiml";
import { canForwardNow, isOpenAt } from "@/lib/hours";
import { forwardingCodes } from "@/lib/telephony/forwarding-codes";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/db/schema";
import { disclosure, fullGreeting } from "@/lib/greeting";

const voice = { ttsProvider: "Google", voiceNb: "nb-NO-Chirp3-HD-Aoede", voiceEn: "en-GB-Chirp3-HD-Aoede", sttProvider: "Deepgram" };

describe("TwiML", () => {
  it("escapes XML", () => {
    expect(esc(`Rør & "Bad" <AS>`)).toBe("Rør &amp; &quot;Bad&quot; &lt;AS&gt;");
  });

  it("builds a ConversationRelay call with recording, Norwegian voice and an uninterruptible greeting", () => {
    const x = conversationRelayTwiml({
      wsUrl: "wss://app.example/api/voice/relay?t=abc",
      actionUrl: "https://app.example/api/telephony/twilio/connect-action?callId=1",
      welcomeGreeting: "Hei, du har kommet til Rør & Co.",
      language: "nb",
      voice,
      hints: ["befaring", "sluk"],
      record: { statusCallback: "https://app.example/rec" },
      params: { callId: "1" },
    });
    expect(x).toContain('<Start><Recording recordingStatusCallback="https://app.example/rec"');
    expect(x).toContain('channels="dual"');
    expect(x).toContain('language="nb-NO"');
    expect(x).toContain('voice="nb-NO-Chirp3-HD-Aoede"');
    expect(x).toContain('welcomeGreetingInterruptible="none"');
    expect(x).toContain('welcomeGreeting="Hei, du har kommet til Rør &amp; Co."');
    expect(x).toContain('<Language code="en-US"');
    expect(x).toContain('<Parameter name="callId" value="1"/>');
    expect(x).toContain('hints="befaring,sluk"');
    expect(x.indexOf("<Start>")).toBeLessThan(x.indexOf("<Connect"));
  });

  it("omits recording when disabled", () => {
    const x = conversationRelayTwiml({ wsUrl: "wss://x", actionUrl: "https://x", welcomeGreeting: "Hei", language: "en", voice, hints: [], record: null, params: {} });
    expect(x).not.toContain("<Recording");
    expect(x).toContain('language="en-US"');
  });

  it("dials the owner with our number as caller id", () => {
    const x = dialTwiml({ number: "+4791234567", callerId: "+4721490001", actionUrl: "https://x/dial" });
    expect(x).toContain('<Dial callerId="+4721490001" timeout="25" action="https://x/dial" answerOnBridge="true"><Number>+4791234567</Number></Dial>');
    expect(sayAndHangup("Hei")).toContain('<Say language="nb-NO"');
  });
});

describe("greeting", () => {
  it("always discloses AI and recording, and keeps the custom part", () => {
    const c = { name: "Fjordbyen Rør AS", recordingEnabled: true, greetingText: "Hva gjelder det?", locale: "nb" };
    expect(disclosure(c)).toBe("Hei, du har kommet til Fjordbyen Rør AS. Jeg er en AI-assistent, og samtalen blir tatt opp.");
    expect(fullGreeting(c)).toMatch(/AI-assistent.*Hva gjelder det\?$/);
    expect(disclosure({ ...c, recordingEnabled: false })).not.toContain("tatt opp");
    expect(disclosure({ ...c, locale: "en" })).toContain("I'm an AI assistant, and this call is recorded");
  });
});

describe("opening hours & forwarding rules (Europe/Oslo)", () => {
  const tz = "Europe/Oslo";
  it("knows when the company is open, across daylight saving", () => {
    expect(isOpenAt(DEFAULT_BUSINESS_HOURS, tz, new Date("2026-11-16T08:00:00Z"))).toBe(true); // Mon 09:00 CET
    expect(isOpenAt(DEFAULT_BUSINESS_HOURS, tz, new Date("2026-11-16T05:30:00Z"))).toBe(false); // Mon 06:30
    expect(isOpenAt(DEFAULT_BUSINESS_HOURS, tz, new Date("2026-06-15T05:30:00Z"))).toBe(true); // Mon 07:30 CEST
    expect(isOpenAt(DEFAULT_BUSINESS_HOURS, tz, new Date("2026-11-21T10:00:00Z"))).toBe(false); // Saturday
    expect(isOpenAt(DEFAULT_BUSINESS_HOURS, tz, new Date("2026-11-20T13:45:00Z"))).toBe(false); // Fri 14:45 (closes 14:30)
  });
  it("applies the forward-when rule", () => {
    const base = { forwardNumber: "+4791234567", businessHours: DEFAULT_BUSINESS_HOURS, timezone: tz };
    const open = new Date("2026-11-16T08:00:00Z");
    const closed = new Date("2026-11-16T20:00:00Z");
    expect(canForwardNow({ ...base, forwardHours: "always" }, closed)).toBe(true);
    expect(canForwardNow({ ...base, forwardHours: "business_hours" }, open)).toBe(true);
    expect(canForwardNow({ ...base, forwardHours: "business_hours" }, closed)).toBe(false);
    expect(canForwardNow({ ...base, forwardHours: "outside_business_hours" }, closed)).toBe(true);
    expect(canForwardNow({ ...base, forwardNumber: null, forwardHours: "always" }, open)).toBe(false);
  });
});

describe("GSM call-forwarding codes", () => {
  it("produces standard codes", () => {
    expect(forwardingCodes("+4721490001")).toEqual({
      allConditional: "**004*+4721490001#",
      noAnswer: "**61*+4721490001**20#",
      busy: "**67*+4721490001#",
      unreachable: "**62*+4721490001#",
      cancelAll: "##002#",
    });
    expect(forwardingCodes("+4721490001", 33).noAnswer).toBe("**61*+4721490001**30#");
  });
});
