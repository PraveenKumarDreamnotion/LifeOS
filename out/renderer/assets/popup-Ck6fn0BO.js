import { r as reactExports, u as useSpeech, j as jsxRuntimeExports, M as Markdown, c as clientExports } from "./global-D2Jx5RDt.js";
const SNOOZE_OPTIONS = [
  { label: "10 min", minutes: 10 },
  { label: "1 hour", minutes: 60 },
  { label: "3 hours", minutes: 180 }
];
function popupChatSend(text, sessionId) {
  return new Promise((resolve, reject) => {
    const buffered = [];
    let targetId = null;
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timeout);
      unsub();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new Error("timeout"));
    }, 5e4);
    const settle = (p) => {
      finish();
      resolve(p.reply);
    };
    const unsub = window.lifeosPopup.chat.onDone((p) => {
      if (settled) return;
      if (targetId !== null && p.turnId === targetId) settle(p);
      else buffered.push(p);
    });
    window.lifeosPopup.chat.send(text, sessionId).then((r) => {
      if (!r.ok) {
        finish();
        reject(new Error(r.error.message));
        return;
      }
      targetId = r.data.turnId;
      const already = buffered.find((p) => p.turnId === targetId);
      if (already && !settled) settle(already);
    }).catch((e) => {
      finish();
      reject(e);
    });
  });
}
let msgCounter = 0;
function PopupApp() {
  const [data, setData] = reactExports.useState(null);
  const [snoozeOpen, setSnoozeOpen] = reactExports.useState(false);
  const [messages, setMessages] = reactExports.useState([]);
  const [text, setText] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);
  const [searching, setSearching] = reactExports.useState(false);
  const [speaking, setSpeaking] = reactExports.useState(false);
  const sessionRef = reactExports.useRef(null);
  const endRef = reactExports.useRef(null);
  const scrollRef = reactExports.useRef(null);
  const stickRef = reactExports.useRef(true);
  const submitRef = reactExports.useRef(() => {
  });
  reactExports.useEffect(() => {
    return window.lifeosPopup.onShow((d) => {
      setData(d);
      setSnoozeOpen(false);
      setMessages([]);
      setText("");
      setSearching(false);
      stickRef.current = true;
      sessionRef.current = d.sessionId;
    });
  }, []);
  reactExports.useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const onTranscript = reactExports.useCallback((t) => submitRef.current(t), []);
  const speech = useSpeech(onTranscript, window.lifeosPopup.speech, () => void window.lifeosPopup.tts.stop());
  reactExports.useEffect(() => window.lifeosPopup.tts.onSpeaking(({ active }) => setSpeaking(active)), []);
  reactExports.useEffect(() => window.lifeosPopup.onSearching(() => setSearching(true)), []);
  if (!data) return null;
  const act = (a) => void window.lifeosPopup.action(a);
  async function submit(input) {
    const t = input.trim();
    if (!t || !data || busy) return;
    setText("");
    setMessages((m) => [...m, { id: ++msgCounter, role: "user", text: t }]);
    setBusy(true);
    setSearching(false);
    const reminderId = data.reminderId;
    try {
      const res = await window.lifeosPopup.message({ reminderId, text: t });
      if (res.ok && !res.data.chat) {
        if (res.data.reply) setMessages((m) => [...m, { id: ++msgCounter, role: "assistant", text: res.data.reply }]);
        return;
      }
      if (!sessionRef.current) {
        const s = await window.lifeosPopup.chat.createSession();
        if (s.ok) sessionRef.current = s.data.id;
      }
      const sid = sessionRef.current;
      const reply = sid ? await popupChatSend(t, sid) : "I couldn't start a conversation just now.";
      setMessages((m) => [...m, { id: ++msgCounter, role: "assistant", text: reply }]);
    } catch {
      setMessages((m) => [...m, { id: ++msgCounter, role: "assistant", text: "I couldn't reach the assistant just now." }]);
    } finally {
      setBusy(false);
      setSearching(false);
    }
  }
  submitRef.current = (t) => void submit(t);
  const listening = speech.state === "listening" || speech.state === "initializing";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "popup", role: "alertdialog", "aria-label": "Reminder from Yogi", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "popup-head", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "popup-avatar", "aria-hidden": true, children: "●" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "popup-brand", children: "Yogi" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "popup-time", children: [
        "Reminder · ",
        data.timeLabel
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "popup-x", "aria-label": "Close", onClick: () => act({ reminderId: data.reminderId, action: "hide" }), children: "✕" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "popup-scroll", ref: scrollRef, onScroll, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "popup-body-content", "aria-live": "assertive", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "popup-title", children: data.title }),
        data.description && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "popup-desc", children: data.description }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "popup-spoken", children: [
          "“",
          data.spokenLine,
          "”"
        ] })
      ] }),
      messages.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "popup-messages", children: [
        messages.map((m) => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: m.role === "user" ? "popup-msg user" : "popup-msg assistant", children: m.role === "assistant" ? /* @__PURE__ */ jsxRuntimeExports.jsx(Markdown, { text: m.text, className: "popup-md" }) : m.text }, m.id)),
        busy && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "popup-msg assistant dim", children: searching ? "🔎 Searching the web…" : /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "typing", "aria-label": "Yogi is thinking", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {})
        ] }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { ref: endRef })
    ] }),
    speaking && /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "popup-stop-speaking", onClick: () => void window.lifeosPopup.tts.stop(), children: "■ Stop speaking" }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("form", { className: "popup-composer", onSubmit: (e) => {
      e.preventDefault();
      void submit(text);
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: listening ? "popup-mic listening" : "popup-mic",
          onClick: speech.toggle,
          disabled: busy,
          "aria-label": listening ? "Stop listening" : "Speak to Yogi",
          title: listening ? "Listening — click to stop" : "Speak to Yogi",
          children: speech.state === "processing" ? "…" : "🎤"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "input",
        {
          className: "popup-input",
          value: listening ? speech.partial || "Listening…" : text,
          onChange: (e) => setText(e.target.value),
          placeholder: "Reply to Yogi — or press the mic",
          maxLength: 2e3,
          readOnly: listening
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "submit", className: "popup-send", disabled: busy || listening || !text.trim(), children: "➤" })
    ] }),
    speech.errorMsg && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "popup-mic-err", children: speech.errorMsg }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("footer", { className: "popup-actions", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "popup-btn primary", onClick: () => act({ reminderId: data.reminderId, action: "complete" }), children: "Complete" }),
      data.canSnooze && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "popup-snooze", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "popup-btn", onClick: () => setSnoozeOpen((v) => !v), "aria-expanded": snoozeOpen, children: "Snooze ▾" }),
        snoozeOpen && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "popup-snooze-menu", role: "menu", children: SNOOZE_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntimeExports.jsx("button", { role: "menuitem", onClick: () => act({ reminderId: data.reminderId, action: "snooze", minutes: o.minutes }), children: o.label }, o.minutes)) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "popup-btn ghost", onClick: () => act({ reminderId: data.reminderId, action: "dismiss" }), children: "Dismiss" }),
      data.queued > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "popup-queue", children: [
        "+",
        data.queued,
        " more"
      ] })
    ] })
  ] });
}
if (typeof window !== "undefined" && !window.lifeosPopup) {
  window.lifeosPopup = {
    onShow: () => () => {
    },
    onSearching: () => () => {
    },
    action: () => Promise.resolve({ ok: true }),
    message: () => Promise.resolve({ ok: true, data: { turnId: "1" } }),
    chat: {
      createSession: () => Promise.resolve({ ok: true, data: "session-id" }),
      send: () => Promise.resolve({ ok: true, data: { turnId: "1" } }),
      onDone: () => () => {
      }
    },
    speech: {
      start: () => Promise.resolve({ ok: true, data: { started: true, supportsPartials: true } }),
      stop: () => Promise.resolve({ ok: true, data: { text: "" } }),
      pushAudio: () => {
      },
      onPartial: () => () => {
      },
      onError: () => () => {
      }
    },
    tts: {
      stop: () => Promise.resolve({ ok: true }),
      onSpeaking: () => () => {
      }
    }
  };
}
clientExports.createRoot(document.getElementById("popup-root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(PopupApp, {}) })
);
