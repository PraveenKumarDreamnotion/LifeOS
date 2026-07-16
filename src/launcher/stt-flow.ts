/**
 * The launcher's provider-specific STT decision, extracted as a pure function so the branch is
 * unit-testable without mounting the whole `LauncherApp`. Given a finalized transcript and the
 * effective STT mode, it decides what the renderer should do next:
 *
 *   • OpenAI STT (`autoSubmit` true) → `submit`: send straight to the chat, hands-free (no Review).
 *   • Offline STT (`autoSubmit` false) → `review`: show the editable draft + Send button.
 *   • Empty transcript, or no active session to submit into → `ignore`.
 */
export type TranscriptAction = { type: 'submit'; text: string } | { type: 'review'; text: string } | { type: 'ignore' };

export function decideTranscriptAction(opts: {
  autoSubmit: boolean;
  sessionId: string | null;
  transcript: string;
}): TranscriptAction {
  const text = opts.transcript.trim();
  if (!text) return { type: 'ignore' };
  if (opts.autoSubmit && opts.sessionId) return { type: 'submit', text };
  return { type: 'review', text };
}
