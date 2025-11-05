import { useState, useRef } from 'react';
import {Mic, Radio} from 'lucide-react';
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
  const recognitionRef = useRef<any>(null); // 型別不明確時用 any

  const handleStart = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
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

      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour12: false });
      const entry = { time, officer: 'Rodriguez', text };

      onTranscript(entry); // ✅ 傳回給 App.tsx
      sendToServer(text);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const sendToServer = async (text: string) => {
    try {
      const res = await fetch('http://localhost:4000/voice-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      console.log('Server response:', data);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 h-40">
      <h2 className="font-semibold text-sm mb-4 ">Voice Communication</h2>
      <div className="flex flex-col items-center space-y-3 ">
        <button
          onMouseDown={handleStart}
          className={`w-10 h-10 ${isRecording ? 'bg-red-600' : 'bg-red-500'} hover:bg-red-700 rounded-full flex items-center justify-center shadow-lg`}
        >
          <Mic className="w-4 h-4 text-white animate-pulse" />
        </button>
        <div className="text-xs text-gray-600 text-center">
          {isRecording ? 'Listening...' : 'Press and hold to talk'}
        </div>
        <label className="flex items-center space-x-2 text-xs">
          <input type="checkbox" className="rounded" />
          <span>Voice Activation</span>
        </label>
        <div className="text-xs text-gray-500 italic">{transcript}</div>
      </div>
    </div>
  );
};

export default VoiceControl;