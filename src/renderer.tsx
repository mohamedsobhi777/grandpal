import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import Orb from './components/orb';
import './App.css';

type ListeningState = 'idle' | 'connecting' | 'listening' | 'stopping';

const App = () => {
  const [listeningState, setListeningState] = useState<ListeningState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTakingScreenshot, setIsTakingScreenshot] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState('en');

  const mediaStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const browserRecognition = useRef<any>(null);
  const usingBrowserFallback = useRef(false);
  const browserPausedForSpeaking = useRef(false);

  useEffect(() => {
    initializeSpeechRecognition();
    initializeBrowserSpeechRecognition();
    greetUser();

    return () => {
      stopListening();
    };
  }, []);

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    window.grandpalAPI.stopSpeaking();
  };

  const pauseBrowserSpeechRecognition = () => {
    if (browserRecognition.current && usingBrowserFallback.current) {
      console.log("Pausing browser speech recognition for TTS");
      browserRecognition.current.stop();
      browserPausedForSpeaking.current = true;
    }
  };

  const resumeBrowserSpeechRecognition = () => {
    if (browserRecognition.current && usingBrowserFallback.current && browserPausedForSpeaking.current) {
      console.log("Resuming browser speech recognition after TTS");
      try {
        browserRecognition.current.start();
        browserPausedForSpeaking.current = false;
      } catch (error) {
        console.error('Error resuming browser recognition:', error);
        browserPausedForSpeaking.current = false;
      }
    }
  };

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
      if (result.isFinal && result.transcript) {
        processVoiceCommand(result.transcript);
      }
    });

    window.grandpalAPI.onSpeechListeningStatus((isListening: boolean) => {
      if (isSpeaking) return;
      setListeningState(isListening ? 'listening' : 'idle');
    });

    window.grandpalAPI.onSpeechPausedStatus((paused: boolean) => {
      setIsPaused(paused);
    });

    window.grandpalAPI.onSpeechError((error: any) => {
      console.error('Speech error:', error);
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
      if (!browserPausedForSpeaking.current) {
        setListeningState('listening');
      }
    };

    recognition.onerror = (event: any) => {
      if (!browserPausedForSpeaking.current) {
        console.error('Browser Speech Error:', event.error);
        setListeningState('idle');
      }
    };

    recognition.onend = () => {
      if (!browserPausedForSpeaking.current) {
        setListeningState('idle');
      }
    };

    recognition.onresult = (event: any) => {
      if (browserPausedForSpeaking.current) {
        return;
      }

      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        processVoiceCommand(finalTranscript.trim());
      }
    };
    browserRecognition.current = recognition;
  };

  const startBrowserSpeechRecognition = (language: string) => {
    if (!browserRecognition.current) {
      console.error('Browser speech recognition not supported.');
      return false;
    }
    try {
      browserRecognition.current.lang = language;
      browserRecognition.current.start();
      return true;
    } catch (error) {
      console.error('Error starting browser recognition:', error);
      return false;
    }
  };

  const stopBrowserSpeechRecognition = () => {
    if (browserRecognition.current) {
      browserRecognition.current.stop();
    }
  };

  const processVoiceCommand = async (command: string) => {
    if (listeningState === 'listening' || listeningState === 'connecting') {
      await stopListening();
    }

    let screenshot: string | undefined;
    
    // Always take screenshot for every command (vision mode always enabled)
    setIsTakingScreenshot(true);
    try {
      const screenshotResult = await window.grandpalAPI.captureScreenshot();
      if (screenshotResult.success && screenshotResult.screenshot) {
        screenshot = screenshotResult.screenshot;
        console.log('Screenshot captured for vision analysis');
      }
    } catch (error) {
      console.error('Error capturing screenshot:', error);
    } finally {
      setIsTakingScreenshot(false);
    }

    const result = await window.grandpalAPI.processVoiceCommand(command, screenshot);
    if (result) {
      await speakResponse(result.response);
    }
  };

  const speakResponse = async (text: string) => {
    setIsSpeaking(true);
    
    if (usingBrowserFallback.current) {
      pauseBrowserSpeechRecognition();
    }
    
    const success = await window.grandpalAPI.speakText(text, currentLanguage);
    if (!success) {
      fallbackSpeak(text);
    }
    
    setTimeout(() => {
      setIsSpeaking(false);
      if (usingBrowserFallback.current) {
        resumeBrowserSpeechRecognition();
      }
    }, 500 + text.length * 50);
  };

  const fallbackSpeak = (text: string) => {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = currentLanguage;
      utterance.onend = () => {
        setIsSpeaking(false);
        if (usingBrowserFallback.current) {
          resumeBrowserSpeechRecognition();
        }
      };
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("Fallback TTS failed:", error);
      setIsSpeaking(false);
      if (usingBrowserFallback.current) {
        resumeBrowserSpeechRecognition();
      }
    }
  };

  const greetUser = () => {
    speakResponse("Hi! I'm GrandPal. I can see your screen and I'll keep my responses brief. Click me to talk.");
  };

  const handleOrbClick = async () => {
    if (listeningState === 'connecting' || listeningState === 'stopping' || isSpeaking) {
      return;
    }

    if (listeningState === 'listening') {
      await stopListening();
    } else {
      await startListening();
    }
  };

  const startListening = async () => {
    stopSpeaking();
    setListeningState('connecting');

    try {
      await startMicrophoneCapture();
      const result = await window.grandpalAPI.startSpeechRecognition(currentLanguage);
      if (!result.success) {
        console.error('Could not start listening:', result.error);
        stopMicrophoneCapture();
        startBrowserSpeechRecognition(currentLanguage);
      }
    } catch (error) {
      console.error('Error starting listening:', error);
      setListeningState('idle');
      startBrowserSpeechRecognition(currentLanguage);
    }
  };

  const stopListening = async () => {
    setListeningState('stopping');
    if (usingBrowserFallback.current) {
      stopBrowserSpeechRecognition();
      usingBrowserFallback.current = false;
    } else {
      await window.grandpalAPI.stopSpeechRecognition();
    }
    stopMicrophoneCapture();
    setListeningState('idle');
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

  return (
    <div 
      id="app" 
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        cursor: 'move',
        position: 'relative',
        WebkitAppRegion: 'drag'
      } as React.CSSProperties & { WebkitAppRegion?: string }}
    >
      {/* Vision indicator - small and minimal */}
      {isTakingScreenshot && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '12px',
          color: '#2196F3',
          background: 'rgba(0,0,0,0.7)',
          padding: '4px 8px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <span>📸</span>
        </div>
      )}

      {/* Main orb - make it non-draggable for clicking */}
      <div 
        onClick={handleOrbClick} 
        style={{ 
          cursor: 'pointer',
          borderRadius: '50%',
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties & { WebkitAppRegion?: string }}
      >
        <Orb forceHoverState={listeningState === 'listening' || listeningState === 'connecting' || isSpeaking || isTakingScreenshot} />
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />); 