import { r as reactExports, u as useSpeech, j as jsxRuntimeExports, M as Markdown, c as clientExports } from "./global-D2Jx5RDt.js";
function decideTranscriptAction(opts) {
  const text = opts.transcript.trim();
  if (!text) return { type: "ignore" };
  if (opts.autoSubmit && opts.sessionId) return { type: "submit", text };
  return { type: "review", text };
}
const DESKTOP_VOICE_IDLE_STATE = {
  phase: "idle",
  sessionId: null,
  activeTurnId: null,
  startedAt: null,
  registeredAccelerator: null,
  searching: false,
  error: null,
  sttAutoSubmit: false
};
function turnsToMessages(turns) {
  return turns.flatMap(
    (t) => t.kind === "reminder" ? [{ id: `t-${t.id}-a`, role: "assistant", text: t.assistantText }] : [
      { id: `t-${t.id}-u`, role: "user", text: t.userText },
      { id: `t-${t.id}-a`, role: "assistant", text: t.assistantText }
    ]
  );
}
function useLauncherMessages(sessionId) {
  const [messages, setMessages] = reactExports.useState([]);
  reactExports.useEffect(() => {
    setMessages([]);
    if (!sessionId) return;
    let cancelled = false;
    void window.lifeosLauncher.chat.turns(sessionId).then((r) => {
      if (!cancelled && r.ok) setMessages((prev) => [...turnsToMessages(r.data), ...prev]);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  reactExports.useEffect(() => {
    return window.lifeosLauncher.chat.onTurnStarted(({ sessionId: sid, turnId, userText }) => {
      if (sid !== sessionId) return;
      setMessages(
        (prev) => prev.some((m) => m.id === `t-${turnId}-a`) ? prev : [
          ...prev,
          { id: `t-${turnId}-u`, role: "user", text: userText },
          { id: `t-${turnId}-a`, role: "assistant", text: "", pending: "thinking" }
        ]
      );
    });
  }, [sessionId]);
  reactExports.useEffect(() => {
    return window.lifeosLauncher.chat.onSearching(({ turnId, sessionId: sid }) => {
      if (sid !== sessionId) return;
      setMessages((prev) => prev.map((m) => m.id === `t-${turnId}-a` && m.pending ? { ...m, pending: "searching" } : m));
    });
  }, [sessionId]);
  reactExports.useEffect(() => {
    return window.lifeosLauncher.chat.onTurnAppended(({ sessionId: sid, turn }) => {
      if (sid !== sessionId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === `t-${turn.id}-a`)) {
          return prev.map((m) => {
            if (m.id === `t-${turn.id}-u`) return { ...m, text: turn.userText };
            if (m.id === `t-${turn.id}-a`) return { ...m, text: turn.assistantText, pending: void 0 };
            return m;
          });
        }
        return [...prev, ...turnsToMessages([turn])];
      });
    });
  }, [sessionId]);
  return messages;
}
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
function statusLabel(state, listening, processing) {
  if (listening) return "Listening";
  if (processing || state.phase === "processing") return "Transcribing";
  if (state.searching) return "Searching";
  if (state.phase === "sending") return "Thinking";
  if (state.phase === "speaking") return "Speaking";
  if (state.phase === "review") return "Review";
  if (state.phase === "complete") return "Done";
  if (state.phase === "error") return "Error";
  return "Ready";
}
function Waveform({ volume }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "launcher-wave active", "aria-hidden": true, children: Array.from({ length: 18 }, (_, i) => {
    const factor = 0.3 + volume * 5;
    const barScale = Math.max(0.2, Math.min(3.5, factor * (1 + Math.sin(i * 1.5) * 0.3)));
    return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { transform: `scaleY(${barScale})`, transition: "transform 80ms ease-out" } }, i);
  }) });
}
function LauncherApp() {
  const [voiceState, setVoiceState] = reactExports.useState(DESKTOP_VOICE_IDLE_STATE);
  const [sessionId, setSessionId] = reactExports.useState(null);
  const [text, setText] = reactExports.useState("");
  const [speaking, setSpeaking] = reactExports.useState(false);
  const [now, setNow] = reactExports.useState(Date.now());
  const [recordedDuration, setRecordedDuration] = reactExports.useState(null);
  const [sessions, setSessions] = reactExports.useState([]);
  const [switcherOpen, setSwitcherOpen] = reactExports.useState(false);
  const endRef = reactExports.useRef(null);
  const messages = useLauncherMessages(sessionId);
  const refreshSessions = reactExports.useCallback(async () => {
    const r = await window.lifeosLauncher.listSessions();
    if (r.ok) setSessions(r.data);
  }, []);
  reactExports.useEffect(() => {
    if (!sessionId) return;
    void refreshSessions();
  }, [sessionId, refreshSessions]);
  reactExports.useEffect(() => {
    if (voiceState.phase === "idle" || voiceState.phase === "hover") setSwitcherOpen(false);
  }, [voiceState.phase]);
  const toggleSwitcher = reactExports.useCallback(() => {
    setSwitcherOpen((open) => {
      if (!open) void refreshSessions();
      return !open;
    });
  }, [refreshSessions]);
  const selectSession = reactExports.useCallback(
    async (id) => {
      setSwitcherOpen(false);
      if (id === sessionId) return;
      await window.lifeosLauncher.openConversation(id);
    },
    [sessionId]
  );
  const activeTitle = sessions.find((s) => s.id === sessionId)?.title ?? "Yogi";
  const autoSubmitRef = reactExports.useRef(false);
  reactExports.useEffect(() => {
    autoSubmitRef.current = voiceState.sttAutoSubmit ?? false;
  }, [voiceState.sttAutoSubmit]);
  const justAutoSubmittedRef = reactExports.useRef(false);
  const onTranscript = reactExports.useCallback(
    (transcript) => {
      const action = decideTranscriptAction({ autoSubmit: autoSubmitRef.current, sessionId, transcript });
      if (action.type === "submit") {
        justAutoSubmittedRef.current = true;
        setText("");
        void window.lifeosLauncher.sendTranscript({ sessionId, text: action.text });
        return;
      }
      if (action.type === "review") {
        setText(action.text);
        if (sessionId) void window.lifeosLauncher.reviewReady({ sessionId });
      }
    },
    [sessionId]
  );
  const beforeStart = reactExports.useCallback(() => {
    void window.lifeosLauncher.tts.stop();
  }, []);
  const speech = useSpeech(onTranscript, window.lifeosLauncher.speech, beforeStart);
  const listening = speech.state === "listening" || speech.state === "initializing";
  const processing = speech.state === "processing";
  reactExports.useEffect(() => {
    if (speech.state === "error" && speech.errorMsg) {
      void window.lifeosLauncher.setError(speech.errorMsg);
    }
  }, [speech.state, speech.errorMsg]);
  reactExports.useEffect(() => {
    let cancelled = false;
    void window.lifeosLauncher.getState().then((r) => {
      if (!cancelled && r.ok) {
        setVoiceState(r.data);
        setSessionId(r.data.sessionId);
      }
    });
    const off = window.lifeosLauncher.onStateChanged((state) => {
      setVoiceState(state);
      if (state.sessionId) setSessionId(state.sessionId);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  reactExports.useEffect(() => {
    if (!listening) {
      if (voiceState.startedAt && recordedDuration === null) {
        setRecordedDuration(Date.now() - voiceState.startedAt);
      }
      return;
    }
    setRecordedDuration(null);
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [listening, voiceState.startedAt]);
  reactExports.useEffect(() => {
    return window.lifeosLauncher.onBeginListening(({ sessionId: nextSessionId }) => {
      setSessionId(nextSessionId);
      setText("");
      justAutoSubmittedRef.current = false;
      if (speech.state !== "listening" && speech.state !== "initializing") speech.toggle();
    });
  }, [speech.state, speech.toggle]);
  reactExports.useEffect(() => {
    return window.lifeosLauncher.onStopListening(() => {
      if (speech.state === "listening" || speech.state === "initializing") speech.toggle();
    });
  }, [speech.state, speech.toggle]);
  reactExports.useEffect(() => {
    if (voiceState.phase === "processing" && speech.state === "idle" && !text.trim() && sessionId && !justAutoSubmittedRef.current) {
      void window.lifeosLauncher.reviewReady({ sessionId });
    }
  }, [voiceState.phase, speech.state, text, sessionId]);
  reactExports.useEffect(() => window.lifeosLauncher.tts.onSpeaking(({ active }) => setSpeaking(active)), []);
  reactExports.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, voiceState.phase]);
  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || !sessionId || voiceState.phase === "sending") return;
    setText("");
    await window.lifeosLauncher.sendTranscript({ sessionId, text: trimmed });
  };
  const discard = async () => {
    const currentSession = sessionId;
    setText("");
    await window.lifeosLauncher.discardTranscript({ sessionId: currentSession || "" });
  };
  reactExports.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (switcherOpen) {
        setSwitcherOpen(false);
        return;
      }
      void discard();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sessionId, switcherOpen]);
  const elapsed = voiceState.startedAt ? formatElapsed(recordedDuration !== null ? recordedDuration : now - voiceState.startedAt) : "0:00";
  const canEdit = voiceState.phase === "review" || voiceState.phase === "error";
  if (voiceState.phase === "idle" || voiceState.phase === "hover") return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "section",
    {
      className: `launcher launcher-${voiceState.phase}`,
      "aria-label": "Yogi voice launcher",
      onPointerEnter: () => void window.lifeosLauncher.hoverChanged(true),
      onPointerLeave: () => void window.lifeosLauncher.hoverChanged(false),
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "launcher-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-avatar", "aria-hidden": true, children: "●" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              className: "launcher-switcher-btn",
              onClick: toggleSwitcher,
              "aria-haspopup": "listbox",
              "aria-expanded": switcherOpen,
              title: "Switch conversation",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-switcher-title", children: activeTitle }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-switcher-caret", "aria-hidden": true, children: "▾" })
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-timer", children: elapsed }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-status", children: statusLabel(voiceState, listening, processing) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "launcher-close-btn",
              onClick: () => void discard(),
              title: "Close launcher",
              "aria-label": "Close launcher",
              children: "✕"
            }
          )
        ] }),
        switcherOpen && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "launcher-switcher-menu", role: "listbox", "aria-label": "Conversations", children: [
          sessions.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "launcher-switcher-empty", children: "No conversations yet" }),
          sessions.map((s) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              role: "option",
              "aria-selected": s.id === sessionId,
              className: s.id === sessionId ? "launcher-switcher-item active" : "launcher-switcher-item",
              onClick: () => void selectSession(s.id),
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-switcher-item-icon", "aria-hidden": true, children: s.kind === "email" ? "📧" : "💬" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-switcher-item-title", children: s.title }),
                s.id === sessionId && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-switcher-check", "aria-hidden": true, children: "✓" })
              ]
            },
            s.id
          ))
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "launcher-scroll", children: [
          messages.length === 0 && !listening && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "launcher-empty", children: "Speak to start a conversation." }),
          messages.map((m) => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: m.role === "user" ? "launcher-msg user" : "launcher-msg assistant", children: m.pending === "searching" ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "launcher-msg-status", children: "🔎 Searching the web…" }) : m.pending === "thinking" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "typing", "aria-label": "Yogi is thinking", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", {})
          ] }) : m.role === "assistant" ? (
            // Assistant replies render as Markdown so headings/lists/bold match the main chat
            // (no literal `**`). The user's own transcript stays plain text.
            /* @__PURE__ */ jsxRuntimeExports.jsx(Markdown, { text: m.text, className: "launcher-md" })
          ) : m.text }, m.id)),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { ref: endRef })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "launcher-composer", children: [
          listening ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Waveform, { volume: speech.volume }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "launcher-note", children: speech.partial || "Listening…" })
          ] }) : canEdit ? /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "form",
            {
              className: "launcher-form",
              onSubmit: (e) => {
                e.preventDefault();
                void submit();
              },
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "textarea",
                  {
                    value: text,
                    onChange: (e) => setText(e.target.value),
                    readOnly: listening || processing,
                    "aria-label": "Launcher transcript",
                    rows: 2,
                    placeholder: "Ask Yogi"
                  }
                ),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "launcher-actions", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "launcher-ghost", onClick: () => void discard(), children: "Dismiss" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "submit", className: "launcher-send", disabled: !text.trim() || listening || processing, children: "Send" })
                ] })
              ]
            }
          ) : null,
          (voiceState.error || speech.errorMsg) && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "launcher-error", children: voiceState.error || speech.errorMsg }),
          speaking && /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "launcher-stop", onClick: () => void window.lifeosLauncher.tts.stop(), children: "■ Stop speaking" })
        ] })
      ]
    }
  );
}
if (typeof window !== "undefined" && !window.lifeosLauncher) {
  let mockPhase = "idle";
  const mockSessionId = "00000000-0000-0000-0000-000000000000";
  let stateListeners = [];
  const notifyListeners = () => {
    const state = { phase: mockPhase, sessionId: mockSessionId, activeTurnId: null, startedAt: null, searching: false, error: null };
    stateListeners.forEach((cb) => cb(state));
  };
  window.lifeosLauncher = {
    getState: () => Promise.resolve({ ok: true, data: { phase: mockPhase, sessionId: mockSessionId } }),
    onStateChanged: (cb) => {
      stateListeners.push(cb);
      return () => {
        stateListeners = stateListeners.filter((l) => l !== cb);
      };
    },
    onBeginListening: () => () => {
    },
    onStopListening: () => () => {
    },
    sendTranscript: (_payload) => {
      mockPhase = "sending";
      notifyListeners();
      return new Promise((resolve) => {
        setTimeout(() => {
          mockPhase = "complete";
          notifyListeners();
          resolve({ ok: true, data: { turnId: "mock-turn" } });
          const reply = "Hello! This is a mock Yogi response in your web browser.";
          window.lifeosLauncher.chat._triggerDone({ turnId: "mock-turn", reply });
          if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(reply);
            window.speechSynthesis.speak(utterance);
          }
        }, 1500);
      });
    },
    discardTranscript: () => {
      mockPhase = "idle";
      notifyListeners();
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      return Promise.resolve({ ok: true });
    },
    reviewReady: () => {
      mockPhase = "review";
      notifyListeners();
      return Promise.resolve({ ok: true });
    },
    hoverChanged: () => Promise.resolve({ ok: true }),
    positionChanged: () => Promise.resolve({ ok: true }),
    setInteractive: () => Promise.resolve({ ok: true }),
    setError: () => Promise.resolve({ ok: true }),
    speech: {
      start: () => Promise.resolve({ ok: true, data: { started: true, supportsPartials: true } }),
      stop: () => {
        setTimeout(() => {
          mockPhase = "review";
          notifyListeners();
        }, 500);
        return Promise.resolve({ ok: true, data: { text: "Mock user voice input" } });
      },
      pushAudio: () => {
      },
      onPartial: () => () => {
      },
      onError: () => () => {
      }
    },
    tts: {
      stop: () => {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        return Promise.resolve({ ok: true });
      },
      onSpeaking: () => () => {
      }
    },
    chat: {
      _doneListeners: [],
      onDone: (cb) => {
        window.lifeosLauncher.chat._doneListeners.push(cb);
        return () => {
          window.lifeosLauncher.chat._doneListeners = window.lifeosLauncher.chat._doneListeners.filter((l) => l !== cb);
        };
      },
      _triggerDone: (payload) => {
        window.lifeosLauncher.chat._doneListeners.forEach((cb) => cb(payload));
      },
      onSearching: () => () => {
      }
    }
  };
}
clientExports.createRoot(document.getElementById("launcher-root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(LauncherApp, {}) })
);
