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
  const [conversation, setConversation] = useState<{ speaker: string; message: string; type: string }[]>([]);
  const [interimResult, setInterimResult] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('en');

  const mediaStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const browserRecognition = useRef<any>(null);
  const usingBrowserFallback = useRef(false);
  const browserPausedForSpeaking = useRef(false);

  useEffect(() => {
    initializeSpeechRecognition();
    initializeBrowserSpeechRecognition();
    showDeepgramInstructions();
    greetUser();

    return () => {
      stopListening();
    };
  }, []);

  const stopSpeaking = () => {
    window.speechSynthesis.cancel(); // Stop browser TTS
    window.grandpalAPI.stopSpeaking(); // Stop backend TTS
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
      if (!result.isFinal) {
        setInterimResult(result.transcript);
      } else if (result.isFinal && result.transcript) {
        addToConversation('You', result.transcript, 'user');
        processVoiceCommand(result.transcript);
        setInterimResult('');
      }
    });

    window.grandpalAPI.onSpeechListeningStatus((isListening: boolean) => {
      if (isSpeaking) return; // Ignore listening status changes while speaking
      setListeningState(isListening ? 'listening' : 'idle');
    });

    window.grandpalAPI.onSpeechPausedStatus((paused: boolean) => {
      setIsPaused(paused);
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
      if (!browserPausedForSpeaking.current) {
        setListeningState('listening');
        addToConversation('System', '🎤 Listening with browser...', 'system');
      }
    };

    recognition.onerror = (event: any) => {
      if (!browserPausedForSpeaking.current) {
        addToConversation('System', `Browser Speech Error: ${event.error}`, 'error');
        setListeningState('idle');
      }
    };

    recognition.onend = () => {
      if (!browserPausedForSpeaking.current) {
        setListeningState('idle');
      }
    };

    recognition.onresult = (event: any) => {
      // Don't process results if we paused for speaking
      if (browserPausedForSpeaking.current) {
        return;
      }

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
      browserPausedForSpeaking.current = false;
      return true;
    } catch (error) {
      console.error('Could not start browser recognition:', error);
      return false;
    }
  };

  const stopBrowserSpeechRecognition = () => {
    if (browserRecognition.current) {
      browserRecognition.current.stop();
      browserPausedForSpeaking.current = false;
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

  const takeManualScreenshot = async () => {
    setIsTakingScreenshot(true);
    addToConversation('System', '📸 Taking screenshot...', 'system');
    
    try {
      const screenshotResult = await window.grandpalAPI.captureScreenshot();
      if (screenshotResult.success && screenshotResult.screenshot) {
        addToConversation('System', '✅ Screenshot captured! You can now ask me about what\'s on your screen.', 'system');
        // Process a default command to analyze the screenshot
        const result = await window.grandpalAPI.processVoiceCommand("What do you see on my screen?", screenshotResult.screenshot);
        if (result) {
          addToConversation('GrandPal', result.response, 'assistant');
          await speakResponse(result.response);
        }
      } else {
        addToConversation('System', '❌ Could not capture screenshot. Please try again.', 'error');
      }
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      addToConversation('System', '❌ Error capturing screenshot. Please try again.', 'error');
    } finally {
      setIsTakingScreenshot(false);
    }
  };

  const processVoiceCommand = async (command: string) => {
    if (listeningState === 'listening' || listeningState === 'connecting') {
      await stopListening();
    }

    // Check if the user is asking GrandPal to look at something
    const lookKeywords = ['look at', 'see', 'what\'s on', 'screen', 'display', 'showing', 'visible', 'looking at'];
    const shouldTakeScreenshot = lookKeywords.some(keyword => 
      command.toLowerCase().includes(keyword)
    );

    let screenshot: string | undefined;
    if (shouldTakeScreenshot) {
      setIsTakingScreenshot(true);
      addToConversation('System', '📸 Taking a screenshot to see what you\'re looking at...', 'system');
      try {
        const screenshotResult = await window.grandpalAPI.captureScreenshot();
        if (screenshotResult.success && screenshotResult.screenshot) {
          screenshot = screenshotResult.screenshot;
          console.log('Screenshot captured for vision analysis');
        } else {
          addToConversation('System', 'Could not capture screenshot, continuing without vision.', 'error');
        }
      } catch (error) {
        console.error('Error capturing screenshot:', error);
        addToConversation('System', 'Could not capture screenshot, continuing without vision.', 'error');
      } finally {
        setIsTakingScreenshot(false);
      }
    }

    const result = await window.grandpalAPI.processVoiceCommand(command, screenshot);
    if (result) {
      addToConversation('GrandPal', result.response, 'assistant');
      await speakResponse(result.response);
    }
  };

  const speakResponse = async (text: string) => {
    setIsSpeaking(true);
    
    // Pause speech recognition (both Deepgram and browser fallback)
    if (usingBrowserFallback.current) {
      pauseBrowserSpeechRecognition();
    }
    // Note: Deepgram pause is handled automatically in the voice processor
    
    const success = await window.grandpalAPI.speakText(text, currentLanguage);
    if (!success) {
      fallbackSpeak(text);
    }
    // A more robust solution would be to get a callback when speech ends.
    // For now, we'll estimate when it's safe to listen again.
    setTimeout(() => {
      setIsSpeaking(false);
      // Resume browser speech recognition if using fallback
      if (usingBrowserFallback.current) {
        resumeBrowserSpeechRecognition();
      }
    }, 500 + text.length * 50); // Rough estimate
  };

  const fallbackSpeak = (text: string) => {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = currentLanguage;
      utterance.onend = () => {
        setIsSpeaking(false);
        // Resume browser speech recognition if using fallback
        if (usingBrowserFallback.current) {
          resumeBrowserSpeechRecognition();
        }
      };
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("Fallback TTS failed:", error);
      setIsSpeaking(false);
      // Resume browser speech recognition if using fallback
      if (usingBrowserFallback.current) {
        resumeBrowserSpeechRecognition();
      }
    }
  };

  const greetUser = () => {
    speakResponse("Hello! I'm GrandPal, your voice assistant. Click the orb to talk to me.");
  };

  const handleOrbClick = async () => {
    if (listeningState === 'connecting' || listeningState === 'stopping' || isSpeaking) {
      return; // Do nothing while in a transition state or speaking
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

  const addToConversation = (speaker: string, message: string, type: string) => {
    setConversation((prev) => [...prev, { speaker, message, type }]);
  };

  const getStatusText = () => {
    if (isTakingScreenshot) return 'Taking screenshot...';
    if (isSpeaking) return 'Speaking...';
    if (isPaused) return 'Paused for speaking';
    if (listeningState === 'listening') return 'Listening...';
    return 'Click to Speak';
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
        <div id="status">{getStatusText()}</div>
        
        {/* Control buttons */}
        <div id="controls" style={{ 
          display: 'flex', 
          gap: '10px', 
          alignItems: 'center', 
          justifyContent: 'center',
          marginBottom: '10px'
        }}>
          <button 
            onClick={takeManualScreenshot}
            disabled={isTakingScreenshot || isSpeaking}
            style={{
              padding: '8px 16px',
              backgroundColor: isTakingScreenshot ? '#666' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isTakingScreenshot || isSpeaking ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            {isTakingScreenshot ? '📸 Taking...' : '📸 Look at Screen'}
          </button>
        </div>

        <div onClick={handleOrbClick} style={{ cursor: 'pointer' }}>
          <Orb forceHoverState={listeningState === 'listening' || listeningState === 'connecting' || isSpeaking || isTakingScreenshot} />
        </div>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />); 