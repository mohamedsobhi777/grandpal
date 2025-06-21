import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import Orb from './components/orb';
import './App.css';

const App = () => {
  const [isListening, setIsListening] = useState(false);
  const [conversation, setConversation] = useState<{ speaker: string; message: string; type: string }[]>([]);
  const [interimResult, setInterimResult] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('en');

  const mediaStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const browserRecognition = useRef<any>(null);
  const usingBrowserFallback = useRef(false);

  useEffect(() => {
    initializeSpeechRecognition();
    initializeBrowserSpeechRecognition();
    showDeepgramInstructions();
    greetUser();

    return () => {
      stopListening();
    };
  }, []);

  const startMicrophoneCapture = async () => {
    try {
      console.log("Starting microphone capture...");

      mediaStream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const context = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContext.current = context;

      const source = context.createMediaStreamSource(mediaStream.current);
      const processor = context.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);

        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          int16Data[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        const uint8Data = new Uint8Array(int16Data.buffer);
        window.grandpalAPI.sendAudioChunk(uint8Data);
      };

      source.connect(processor);
      processor.connect(context.destination);

      console.log("Microphone capture started successfully with Web Audio API");
    } catch (error) {
      console.error("Error starting microphone:", error);
      throw error;
    }
  };

  const initializeSpeechRecognition = () => {
    window.grandpalAPI.onSpeechTranscript((result: any) => {
      if (!result.isFinal) {
        setInterimResult(result.transcript);
      } else if (result.isFinal && result.transcript) {
        addToConversation('You', result.transcript, 'user');
        processVoiceCommand(result.transcript);
        setInterimResult('');
      }
    });

    window.grandpalAPI.onSpeechListeningStatus((isListening: boolean) => {
      setIsListening(isListening);
    });

    window.grandpalAPI.onSpeechError((error: any) => {
      addToConversation('System', `Error: ${error.message || JSON.stringify(error)}`, 'error');
    });

    window.grandpalAPI.onSpeechFallbackToBrowser((data: { language: string }) => {
      console.log('Fallback to browser speech recognition triggered from main process');
      usingBrowserFallback.current = true;
      startBrowserSpeechRecognition(data.language);
    });
  };

  const initializeBrowserSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Browser Speech Recognition not available.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      addToConversation('System', '🎤 Listening with browser...', 'system');
    };

    recognition.onerror = (event: any) => {
      addToConversation('System', `Browser Speech Error: ${event.error}`, 'error');
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        addToConversation('You', finalTranscript.trim(), 'user');
        processVoiceCommand(finalTranscript.trim());
      }
      setInterimResult(interimTranscript);
    };
    browserRecognition.current = recognition;
  };

  const startBrowserSpeechRecognition = (language: string) => {
    if (!browserRecognition.current) {
      addToConversation('System', 'Browser speech recognition not supported.', 'error');
      return false;
    }
    try {
      browserRecognition.current.lang = language;
      browserRecognition.current.start();
      usingBrowserFallback.current = true;
      return true;
    } catch (error) {
      console.error('Could not start browser recognition:', error);
      return false;
    }
  };

  const stopBrowserSpeechRecognition = () => {
    if (browserRecognition.current) {
      browserRecognition.current.stop();
    }
  };

  const showDeepgramInstructions = async () => {
    const result = await window.grandpalAPI.getDeepgramInstructions();
    if (!result.instructions || result.instructions === 'demo-key') {
      addToConversation(
        'System',
        '💡 For better speech recognition, get a free Deepgram API key and set it in your .env file.',
        'system'
      );
    }
  };

  const processVoiceCommand = async (command: string) => {
    const result = await window.grandpalAPI.processVoiceCommand(command);
    if (result) {
      addToConversation('GrandPal', result.response, 'assistant');
      speakResponse(result.response);
    }
  };

  const speakResponse = async (text: string) => {
    const success = await window.grandpalAPI.speakText(text, currentLanguage);
    if (!success) {
      fallbackSpeak(text);
    }
  };

  const fallbackSpeak = (text: string) => {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = currentLanguage;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("Fallback TTS failed:", error);
    }
  };

  const greetUser = () => {
    speakResponse("Hello! I'm GrandPal, your voice assistant. Click the orb to talk to me.");
  };

  const startListening = async () => {
    if (isListening) {
      await stopListening();
      return;
    }

    try {
      addToConversation('System', 'Connecting...', 'system');
      await startMicrophoneCapture();
      const result = await window.grandpalAPI.startSpeechRecognition(currentLanguage);
      if (!result.success) {
        addToConversation('System', `Could not start listening: ${result.error}. Trying browser fallback.`, 'error');
        stopMicrophoneCapture();
        startBrowserSpeechRecognition(currentLanguage);
      }
    } catch (error) {
      console.error('Error starting listening:', error);
      addToConversation('System', `Error starting microphone: ${(error as Error).message}. Trying browser fallback.`, 'error');
      setIsListening(false);
      startBrowserSpeechRecognition(currentLanguage);
    }
  };

  const stopListening = async () => {
    if (usingBrowserFallback.current) {
      stopBrowserSpeechRecognition();
      usingBrowserFallback.current = false;
    } else {
      await window.grandpalAPI.stopSpeechRecognition();
    }
    stopMicrophoneCapture();
    setIsListening(false);
  };

  const stopMicrophoneCapture = () => {
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
    }

    if (audioContext.current && audioContext.current.state !== 'closed') {
      audioContext.current.close();
    }
    console.log('Microphone capture stopped.');
  };

  const addToConversation = (speaker: string, message: string, type: string) => {
    setConversation((prev) => [...prev, { speaker, message, type }]);
  };

  return (
    <div id="app">
      <div id="conversation">
        {conversation.map((entry, index) => (
          <div key={index} className={`message message-${entry.type}`}>
            <strong>{entry.speaker}:</strong> {entry.message}
          </div>
        ))}
      </div>
      <div id="bottom-container">
        <div id="interim-results">{interimResult}</div>
        <div id="status">{isListening ? 'Listening...' : 'Click to Speak'}</div>
        <div onClick={startListening} style={{ cursor: 'pointer' }}>
          <Orb forceHoverState={isListening} />
        </div>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />); 