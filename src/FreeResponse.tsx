import { useEffect, useRef, useState } from 'react';

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: { length: number; [index: number]: SpeechResult } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
type Props = { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void; onListeningChange?: (listening: boolean) => void; maxLength?: number };

export function FreeResponse({ id, label, placeholder, value, onChange, onListeningChange, maxLength = 1000 }: Props) {
  const recognition = useRef<Recognition | null>(null);
  const latest = useRef({ value, onChange, onListeningChange });
  latest.current = { value, onChange, onListeningChange };
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('');
  const [interim, setInterim] = useState('');
  const speechWindow = window as SpeechWindow;
  const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

  useEffect(() => () => {
    const session = recognition.current;
    if (session) { session.onresult = null; session.onerror = null; session.onend = null; session.abort(); }
    latest.current.onListeningChange?.(false);
  }, []);

  function toggleVoice() {
    if (recognition.current) { recognition.current.stop(); setStatus('Finishing transcription...'); return; }
    if (!SpeechRecognition) { setStatus('Voice input is unavailable in this browser. You can still type your answer.'); return; }
    if (value.length >= maxLength) { setStatus('Your answer is at the character limit. Shorten it before adding more.'); return; }
    const session = new SpeechRecognition();
    recognition.current = session;
    session.lang = document.documentElement.lang || 'en-US';
    session.continuous = true;
    session.interimResults = true;
    let failed = false;
    let receivedSpeech = false;
    session.onresult = event => {
      let finalText = '';
      let preview = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else preview += result[0].transcript;
      }
      setInterim(preview);
      if (finalText.trim()) {
        receivedSpeech = true;
        const next = `${latest.current.value}${latest.current.value.trim() ? ' ' : ''}${finalText.trim()}`.slice(0, maxLength);
        latest.current.value = next;
        latest.current.onChange(next);
        if (next.length >= maxLength) { session.stop(); setStatus('Character limit reached. Review your answer below.'); }
      }
    };
    session.onerror = event => {
      failed = true;
      const messages: Record<string, string> = {
        'not-allowed': 'Microphone access was denied. Allow it in your browser settings or type your answer.',
        'service-not-allowed': 'Speech recognition is unavailable. You can type your answer instead.',
        'audio-capture': 'No microphone is available. Connect one or type your answer.',
        'no-speech': 'No speech was detected. Try again or type your answer.',
        'network': 'Speech recognition could not connect. Try again or type your answer.',
      };
      setStatus(messages[event.error] ?? 'Voice input stopped. You can retry or type your answer.');
    };
    session.onend = () => {
      recognition.current = null;
      setListening(false);
      latest.current.onListeningChange?.(false);
      setInterim('');
      if (!failed) setStatus(receivedSpeech ? 'Transcription added. You can edit your answer before continuing.' : 'No words were added. Try again or type your answer.');
    };
    try {
      session.start();
      setListening(true);
      onListeningChange?.(true);
      setStatus('Listening. Speak your answer, then select Stop dictation.');
    } catch {
      recognition.current = null;
      setStatus('Voice input could not start. Try again or type your answer.');
    }
  }

  return <div className="free-response">
    <label className="sr-only" htmlFor={id}>{label}</label>
    <textarea id={id} placeholder={placeholder} maxLength={maxLength} rows={2} value={value} readOnly={listening} aria-describedby={`${id}-voice-status ${id}-voice-note`} onChange={event => onChange(event.target.value)} />
    <div className="voice-toolbar">
      <button type="button" className={`voice-button ${listening ? 'listening' : ''}`} onClick={toggleVoice} aria-pressed={listening} aria-controls={id}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        {listening ? 'Stop dictation' : 'Use my voice'}
      </button>
      <span className="character-count">{value.length}/{maxLength}</span>
    </div>
    <p className="voice-status" id={`${id}-voice-status`} role="status">{interim || status || (!SpeechRecognition ? 'Voice input is unavailable in this browser. You can still type your answer.' : 'Type or speak. You can review and edit before continuing.')}</p>
    <p className="voice-note" id={`${id}-voice-note`}>Voice may use your browser's online speech service.</p>
  </div>;
}
