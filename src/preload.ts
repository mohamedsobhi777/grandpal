// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// Expose GrandPal APIs to the renderer process
contextBridge.exposeInMainWorld('grandpalAPI', {
  // Voice command processing
  processVoiceCommand: (command: string) => 
    ipcRenderer.invoke('process-voice-command', command),
  
  // Speech recognition control
  startSpeechRecognition: (language?: string) =>
    ipcRenderer.invoke('start-speech-recognition', language),
  
  stopSpeechRecognition: () =>
    ipcRenderer.invoke('stop-speech-recognition'),
  
  isSpeechListening: () =>
    ipcRenderer.invoke('is-speech-listening'),
  
  // Filesystem operations
  executeFilesystemAction: (action: string, params: any) => 
    ipcRenderer.invoke('execute-filesystem-action', action, params),
  
  // Text-to-speech
  speakText: (text: string, language?: string) => 
    ipcRenderer.invoke('speak-text', text, language),
  
  // Get setup instructions
  getDeepgramInstructions: () =>
    ipcRenderer.invoke('get-deepgram-instructions'),
  
  // Get environment variable
  getEnvVar: (name: string) =>
    ipcRenderer.invoke('get-env-var', name),
  
  // Speech recognition events
  onSpeechTranscript: (callback: (result: any) => void) => {
    ipcRenderer.on('speech-transcript', (event, result) => callback(result));
  },
  
  onSpeechListeningStatus: (callback: (isListening: boolean) => void) => {
    ipcRenderer.on('speech-listening-status', (event, isListening) => callback(isListening));
  },
  
  onSpeechError: (callback: (error: any) => void) => {
    ipcRenderer.on('speech-error', (event, error) => callback(error));
  },

  onSpeechFallbackToBrowser: (callback: (data: any) => void) => {
    ipcRenderer.on('speech-fallback-to-browser', (event, data) => callback(data));
  },
  
  sendAudioChunk: (chunk: Uint8Array) => {
    ipcRenderer.send('audio-chunk', chunk);
  },
  
  // Remove speech recognition listeners
  removeSpeechListeners: () => {
    ipcRenderer.removeAllListeners('speech-transcript');
    ipcRenderer.removeAllListeners('speech-listening-status');
    ipcRenderer.removeAllListeners('speech-error');
    ipcRenderer.removeAllListeners('speech-fallback-to-browser');
  }
});

// Type definitions for TypeScript
declare global {
  interface Window {
    grandpalAPI: {
      processVoiceCommand: (command: string) => Promise<{response: string, action: string}>;
      startSpeechRecognition: (language?: string) => Promise<{success: boolean, error?: string}>;
      stopSpeechRecognition: () => Promise<{success: boolean, error?: string}>;
      isSpeechListening: () => Promise<{listening: boolean}>;
      executeFilesystemAction: (action: string, params: any) => Promise<{success: boolean, message: string}>;
      speakText: (text: string, language?: string) => Promise<{success: boolean}>;
      getDeepgramInstructions: () => Promise<{instructions: string}>;
      getEnvVar: (name: string) => Promise<string>;
      onSpeechTranscript: (callback: (result: any) => void) => void;
      onSpeechListeningStatus: (callback: (isListening: boolean) => void) => void;
      onSpeechError: (callback: (error: any) => void) => void;
      onSpeechFallbackToBrowser: (callback: (data: any) => void) => void;
      sendAudioChunk: (chunk: Uint8Array) => void;
      removeSpeechListeners: () => void;
    };
  }
}
