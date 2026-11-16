"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Mic, PhoneCall, PhoneOff, Send, Volume2, VolumeX } from "lucide-react";
import { Button, Card, Input, buttonClass } from "@/components/ui";
import { dict, type Locale } from "@/lib/i18n";

type Bubble = { role: "agent" | "caller" | "system"; text: string };
type Ev = { type: string; token?: string; lang?: string; action?: string; ended?: { action: string } | null };

// Minimal typing for the (prefixed) Web Speech API.
type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void; start(): void; stop(): void };

export function Simulator({ locale, aiReady }: { locale: Locale; aiReady: boolean }) {
  const t = dict(locale);
  const [simId, setSimId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState<{ callId: string | null } | null>(null);
  const [text, setText] = useState("");
  const [speak, setSpeak] = useState(true);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState<"nb" | "en">(locale === "en" ? "en" : "nb");
  const listRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<Recognition | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles]);

  const say = useCallback(
    (s: string) => {
      if (!speak || typeof window === "undefined" || !window.speechSynthesis || !s.trim()) return;
      const u = new SpeechSynthesisUtterance(s);
      u.lang = lang === "en" ? "en-GB" : "nb-NO";
      const v = window.speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(lang === "en" ? "en" : "nb") || x.lang.toLowerCase().startsWith("no"));
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    },
    [speak, lang],
  );

  const start = async () => {
    setBubbles([]);
    setEnded(null);
    setBusy(true);
    try {
      const res = await fetch("/api/simulator", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { id: string; greeting: string };
      setSimId(d.id);
      setBubbles([{ role: "agent", text: d.greeting }]);
      say(d.greeting);
    } catch {
      setBubbles([{ role: "system", text: t.common.error }]);
    } finally {
      setBusy(false);
    }
  };

  const end = async (id = simId) => {
    if (!id) return;
    setSimId(null);
    window.speechSynthesis?.cancel();
    const res = await fetch("/api/simulator", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "end", id }) });
    const d = (await res.json().catch(() => ({}))) as { callId?: string };
    setEnded({ callId: d.callId ?? null });
  };

  const send = async (raw: string) => {
    const msg = raw.trim();
    if (!msg || !simId) return;
    setText("");
    window.speechSynthesis?.cancel();
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBubbles((b) => [...b, { role: "caller", text: msg }, { role: "agent", text: "" }]);
    setBusy(true);
    let utter = "";
    let endedNow = false;
    try {
      const res = await fetch("/api/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "say", id: simId, text: msg }),
        signal: ac.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "");
          if (!line) continue;
          const ev = JSON.parse(line) as Ev;
          if (ev.type === "text" && ev.token) {
            utter += ev.token;
            setBubbles((b) => {
              const copy = [...b];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, text: last.text + ev.token };
              return copy;
            });
          } else if (ev.type === "utterance_end") {
            say(utter);
            utter = "";
            setBubbles((b) => (b[b.length - 1]?.text ? [...b, { role: "agent", text: "" }] : b));
          } else if (ev.type === "language" && (ev.lang === "en" || ev.lang === "nb")) {
            setLang(ev.lang);
          } else if (ev.type === "end" || (ev.type === "done" && ev.ended)) {
            endedNow = true;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setBubbles((b) => [...b, { role: "system", text: t.common.error }]);
    } finally {
      setBubbles((b) => b.filter((x, i) => !(i === b.length - 1 && x.role === "agent" && !x.text)));
      setBusy(false);
      if (endedNow) void end();
    }
  };

  const listen = () => {
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    window.speechSynthesis?.cancel();
    const rec = new Ctor();
    rec.lang = lang === "en" ? "en-GB" : "nb-NO";
    rec.interimResults = false;
    rec.onresult = (e) => void send(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const canListen = typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  if (!aiReady) {
    return <Card className="p-5 text-sm text-amber-900 ring-amber-200">{t.testAgent.noAi}</Card>;
  }

  return (
    <Card className="flex h-[70dvh] min-h-[420px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <span className={clsx("inline-flex items-center gap-2 text-sm font-medium", simId ? "text-emerald-700" : "text-slate-500")}>
          <span className={clsx("h-2 w-2 rounded-full", simId ? "animate-pulse bg-emerald-500" : "bg-slate-300")} />
          {simId ? (busy ? t.testAgent.thinking : t.testAgent.title) : ended ? t.testAgent.ended : t.testAgent.title}
        </span>
        <button
          className={buttonClass("ghost", "sm")}
          onClick={() => {
            setSpeak((s) => !s);
            window.speechSynthesis?.cancel();
          }}
          aria-pressed={speak}
          aria-label={t.testAgent.voiceOn}
        >
          {speak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          <span className="hidden sm:inline">{t.testAgent.voiceOn}</span>
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50/60 p-4" aria-live="polite">
        {bubbles.length === 0 && !ended && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-md text-sm text-slate-600">{t.testAgent.intro}</p>
            <Button size="lg" onClick={start} disabled={busy}>
              <PhoneCall className="h-5 w-5" aria-hidden /> {t.testAgent.start}
            </Button>
          </div>
        )}
        {bubbles.map((b, i) =>
          b.role === "system" ? (
            <p key={i} className="text-center text-xs text-slate-500">
              {b.text}
            </p>
          ) : (
            <div key={i} className={clsx("flex", b.role === "caller" ? "justify-end" : "justify-start")}>
              <p
                className={clsx(
                  "max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-[0.95rem] leading-snug",
                  b.role === "caller" ? "rounded-br-md bg-brand-700 text-white" : "rounded-bl-md bg-white text-slate-900 ring-1 ring-slate-200",
                )}
              >
                {b.text || <span className="inline-block animate-pulse text-slate-400">●●●</span>}
              </p>
            </div>
          ),
        )}
        {ended && (
          <div className="flex flex-col items-center gap-3 pt-4 text-center">
            <p className="text-sm font-medium text-slate-700">{t.testAgent.ended}</p>
            <div className="flex gap-2">
              {ended.callId && (
                <Link href={`/calls/${ended.callId}`} className={buttonClass("secondary")}>
                  {t.testAgent.openCall}
                </Link>
              )}
              <Button onClick={start}>{t.testAgent.restart}</Button>
            </div>
          </div>
        )}
      </div>

      {simId && (
        <form
          className="flex items-center gap-2 border-t border-slate-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          {canListen && (
            <button
              type="button"
              onClick={listening ? () => recRef.current?.stop() : listen}
              className={buttonClass(listening ? "danger" : "secondary", "md", "!px-3")}
              aria-label={listening ? t.testAgent.listening : t.testAgent.speak}
            >
              <Mic className={clsx("h-5 w-5", listening && "animate-pulse")} />
            </button>
          )}
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? t.testAgent.listening : t.testAgent.placeholder} aria-label={t.testAgent.placeholder} autoFocus />
          <button type="submit" className={buttonClass("primary", "md", "!px-3")} aria-label={t.testAgent.send} disabled={!text.trim()}>
            <Send className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => void end()} className={buttonClass("danger", "md", "!px-3")} aria-label={t.testAgent.end}>
            <PhoneOff className="h-5 w-5" />
          </button>
        </form>
      )}
    </Card>
  );
}
