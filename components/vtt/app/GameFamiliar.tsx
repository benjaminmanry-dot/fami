"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type FamiliarSource = {
  source: string;
  section: string;
  url: string;
};

type FamiliarFact = {
  label: string;
  value: string;
  provenance: string;
  followUp?: string;
};

type FamiliarMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  fact?: FamiliarFact;
  reference?: FamiliarSource | null;
  sources?: FamiliarSource[];
  intro?: true;
};

type GameFamiliarProps = {
  roomId: string;
  clientId: string;
  dmKey: string;
  sheetId: string | null;
  sheetName: string | null;
};

const greeting = "Ask me about your character, the 2024 rules, or how to use this tabletop.";

function FamiliarText({ content }: { content: string }) {
  return content.split(/(\*\*[^*\r\n]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part
  );
}

export function GameFamiliar({
  roomId,
  clientId,
  dmKey,
  sheetId,
  sheetName,
}: GameFamiliarProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<FamiliarMessage[]>([
    { id: "familiar-greeting", role: "assistant", content: greeting, intro: true },
  ]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, open]);

  async function ask(rawQuestion: string) {
    const text = rawQuestion.trim();
    if (!text || busy) return;
    const userMessage: FamiliarMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const history = messages.filter(({ intro }) => !intro).slice(-4).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setBusy(true);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-VTT-Room": roomId,
        "X-VTT-Client": clientId,
      };
      if (dmKey) headers["X-VTT-DM-Key"] = dmKey;
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers,
        body: JSON.stringify({ question: text, sheetId, history }),
      });
      const payload = await response.json().catch(() => ({})) as {
        answer?: string;
        error?: string;
        code?: string;
        fact?: FamiliarFact;
        reference?: FamiliarSource | null;
        sources?: FamiliarSource[];
      };
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error || "The Game Familiar could not answer right now.");
      }
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: payload.answer!,
        fact: payload.fact,
        reference: payload.reference,
        sources: payload.sources,
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: error instanceof Error ? error.message : "The Game Familiar could not answer right now.",
      }]);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className={open ? "game-familiar open" : "game-familiar"}>
      {open && (
        <section className="familiar-panel" role="dialog" aria-label="Game Familiar">
          <header className="familiar-header">
            <div className="familiar-portrait" aria-hidden="true">?</div>
            <div>
              <strong>Game Familiar</strong>
              <span>{sheetName ? `Reading ${sheetName}'s sheet` : dmKey ? "Full rules library" : "Rules & tabletop help"}</span>
            </div>
            <button type="button" aria-label="Close Game Familiar" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="familiar-log" ref={logRef} aria-live="polite">
            {messages.map((message) => (
              <article key={message.id} className={`familiar-message ${message.role}`}>
                <span>{message.role === "assistant" ? "Familiar" : "You"}</span>
                {message.reference && (
                  <a
                    className="familiar-reference"
                    href={message.reference.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>Rule reference</span>
                    <strong>{message.reference.section.split(" > ").at(-1) || message.reference.source}</strong>
                  </a>
                )}
                {message.fact ? (
                  <div className="familiar-fact">
                    <span>{message.fact.label}</span>
                    <strong>{message.fact.value}</strong>
                    <small>{message.fact.provenance}</small>
                  </div>
                ) : (
                  <p>{message.role === "assistant" ? <FamiliarText content={message.content} /> : message.content}</p>
                )}
                {message.fact?.followUp && (
                  <div className="familiar-actions">
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Explain ${message.fact.label}`}
                      onClick={() => void ask(message.fact?.followUp ?? "")}
                    >
                      How?
                    </button>
                  </div>
                )}
                {!!message.sources?.length && (
                  <details>
                    <summary>{message.sources.length} more source{message.sources.length === 1 ? "" : "s"}</summary>
                    <ul>
                      {message.sources.map((source) => (
                        <li key={`${source.source}-${source.section}`}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            <strong>{source.source}</strong>{source.section ? ` — ${source.section}` : ""}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
            {busy && <div className="familiar-thinking"><i /><i /><i /><span>Checking…</span></div>}
          </div>
          {messages.length === 1 && (
            <div className="familiar-suggestions" aria-label="Suggested questions">
              {sheetName && <button type="button" onClick={() => void ask("Explain how my character build works.")}>Explain my build</button>}
              <button type="button" onClick={() => void ask("How do I move a token and pan the map?")}>Using the map</button>
              <button type="button" onClick={() => void ask("How does passive Perception work?")}>Passive checks</button>
            </div>
          )}
          <form className="familiar-form" onSubmit={submit}>
            <label htmlFor="familiar-question">Ask a question</label>
            <textarea
              id="familiar-question"
              value={question}
              maxLength={600}
              rows={2}
              disabled={busy}
              placeholder="What can my character do here?"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={submitOnEnter}
            />
            <button type="submit" disabled={busy || !question.trim()}>Ask</button>
          </form>
          <small className="familiar-disclaimer">Answers are grounded in your authorized sheet and the in-app library. The Familiar cannot change game state.</small>
        </section>
      )}
      <button
        type="button"
        className="familiar-launcher"
        aria-expanded={open}
        aria-label={open ? "Close Game Familiar" : "Ask the Game Familiar"}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
        <strong>{open ? "Close" : "Ask Familiar"}</strong>
      </button>
    </div>
  );
}
