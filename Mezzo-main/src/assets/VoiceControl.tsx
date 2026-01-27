import { useState, useRef } from 'react';
import { Mic } from 'lucide-react';

interface Transcript {
  time: string;
  officer: string;
  text: string;
}

interface VoiceControlProps {
  onTranscript: (entry: Transcript) => void;
}

const VoiceControl = ({ onTranscript }: VoiceControlProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  const handleStart = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Your browser does not support Speech Recognition.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      console.log('[VoiceControl] Transcribed:', text);

      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour12: false });
      const entry = { time, officer: 'Rodriguez', text };

      onTranscript(entry);
      sendToServer(text);
    };

    recognition.onerror = (event: any) => {
      console.error('[VoiceControl] Speech recognition error:', event.error);
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const sendToServer = async (text: string) => {
    console.log('[VoiceControl] Sending to server:', text);
    try {
      const res = await fetch('http://localhost:4000/voice-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      console.log('[VoiceControl] Server response:', data);
    } catch (err) {
      console.error('[VoiceControl] Failed to send message:', err);
    }
  };

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4 h-40">
      <h2 className="font-semibold text-sm mb-4 text-slate-100">Voice Communication</h2>
      <div className="flex flex-col items-center space-y-3">
        <button
          onMouseDown={handleStart}
          className={`w-10 h-10 ${isRecording ? 'bg-red-600 animate-pulse' : 'bg-red-500'} hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg transition-colors`}
        >
          <Mic className="w-4 h-4 text-white" />
        </button>
        <div className="text-xs text-slate-400 text-center">
          {isRecording ? 'Listening...' : 'Press and hold to talk'}
        </div>
        <label className="flex items-center space-x-2 text-xs text-slate-300">
          <input type="checkbox" className="rounded bg-slate-700 border-slate-600" />
          <span>Voice Activation</span>
        </label>
        <div className="text-xs text-slate-500 italic">{transcript}</div>
      </div>
    </div>
  );
};

export default VoiceControl;