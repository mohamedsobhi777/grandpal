/**
 * GrandPal Deepgram Speech Recognition Service
 * Handles real-time speech-to-text using Deepgram API
 */

import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { EventEmitter } from "events";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

export const DEEPGRAM_SETUP_INSTRUCTIONS = "To use Deepgram, you need to get a free API key from https://deepgram.com and add it to a .env file in the root of the project like this: DEEPGRAM_API_KEY=YOUR_API_KEY";

export interface SpeechRecognitionResult {
    transcript: string;
    confidence: number;
    isFinal: boolean;
}

export class DeepgramSpeechService extends EventEmitter {
    private deepgram: any;
    private connection: any = null;
    private isListening = false;
    private isPaused = false;
    private language = "en";

    private apiKey = process.env.DEEPGRAM_API_KEY || "demo-key";

    constructor() {
        super();
        this.initializeDeepgram();
    }

    private initializeDeepgram(): void {
        try {
            if (this.apiKey !== "demo-key") {
                this.deepgram = createClient(this.apiKey);
                console.log("Deepgram client initialized with API key");
            } else {
                console.log("No Deepgram API key found - will use browser fallback");
            }
        } catch (error) {
            console.error("Failed to initialize Deepgram:", error);
            this.emit("error", "Deepgram initialization failed");
        }
    }

    sendAudio(chunk: Buffer) {
        if (this.connection && this.connection.getReadyState() === 1 && this.isListening && !this.isPaused) {
            this.connection.send(chunk);
        }
    }

    async startListening(language = "en"): Promise<boolean> {
        if (this.isListening) {
            console.log("Already listening");
            return true;
        }

        this.language = language;
        this.isPaused = false;

        try {
            if (this.apiKey !== "demo-key" && this.deepgram) {
                return await this.startDeepgramListening();
            } else {
                return this.startBrowserFallback();
            }
        } catch (error) {
            console.error("Error starting speech recognition:", error);
            this.emit("error", error);
            return this.startBrowserFallback();
        }
    }

    private async startDeepgramListening(): Promise<boolean> {
        try {
            console.log("Starting Deepgram live transcription in main process...");

            this.connection = this.deepgram.listen.live({
                model: "nova-2",
                language: this.mapLanguageCode(this.language),
                smart_format: true,
                interim_results: true,
                utterance_end_ms: 1000,
                vad_events: true,
                endpointing: 300,
                channels: 1,
                sample_rate: 16000,
                encoding: "linear16"
            });

            this.connection.on("open", () => {
                console.log("Deepgram connection opened");
                this.isListening = true;
                this.emit("listening", true);
            });

            this.connection.on("close", () => {
                console.log("Deepgram connection closed");
                this.isListening = false;
                this.isPaused = false;
                this.emit("listening", false);
            });

            this.connection.on("Metadata", (data: any) => {
                console.log(`Deepgram Metadata:`, data);
            });

            this.connection.on("Results", (data: any) => {
                if (this.isPaused) {
                    return;
                }

                const sentence = data.channel?.alternatives?.[0]?.transcript;
                
                if (!sentence || sentence.length === 0) {
                    return;
                }

                const result: SpeechRecognitionResult = {
                    transcript: sentence.trim(),
                    confidence: data.channel?.alternatives?.[0]?.confidence || 0.5,
                    isFinal: data.is_final || false,
                };

                if (data.is_final) {
                    console.log(`Final: ${sentence}`);
                    if (data.speech_final) {
                        console.log(`Speech Final: ${sentence}`);
                    }
                } else {
                    console.log(`Interim: ${sentence}`);
                }

                this.emit("transcript", result);
            });

            this.connection.on("UtteranceEnd", (data: any) => {
                console.log("Deepgram UtteranceEnd detected");
            });

            this.connection.on("SpeechStarted", (data: any) => {
                console.log("Deepgram SpeechStarted");
            });

            this.connection.on("error", (err: any) => {
                console.error("Deepgram error:", err);
                this.emit("error", err);
            });

            return true;
        } catch (error) {
            console.error("Error starting Deepgram:", error);
            throw error;
        }
    }

    private startBrowserFallback(): boolean {
        console.log("Using browser speech recognition fallback");
        this.isListening = true;
        this.emit("listening", true);

        this.emit("fallback-to-browser", { language: this.language });
        
        return true;
    }

    pauseListening(): void {
        if (this.isListening && !this.isPaused) {
            console.log("Pausing speech recognition (assistant speaking)");
            this.isPaused = true;
            this.emit("paused", true);
        }
    }

    resumeListening(): void {
        if (this.isListening && this.isPaused) {
            console.log("Resuming speech recognition (assistant finished speaking)");
            this.isPaused = false;
            this.emit("paused", false);
        }
    }

    stopListening(): void {
        if (!this.isListening) {
            console.log("Not currently listening");
            return;
        }

        try {
            if (this.connection) {
                this.connection.finish();
                this.connection = null;
            }

            this.isListening = false;
            this.isPaused = false;
            this.emit("listening", false);
            console.log("Stopped listening");
        } catch (error) {
            console.error("Error stopping listening:", error);
        }
    }

    private mapLanguageCode(language: string): string {
        const languageMap: { [key: string]: string } = {
            en: "en-US",
            es: "es",
            fr: "fr",
            de: "de",
            it: "it",
            pt: "pt",
            nl: "nl",
            ru: "ru",
            ja: "ja",
            ko: "ko",
            zh: "zh-CN",
            hi: "hi"
        };
        return languageMap[language] || language;
    }

    isCurrentlyListening(): boolean {
        return this.isListening;
    }

    isCurrentlyPaused(): boolean {
        return this.isPaused;
    }

    setLanguage(language: string): void {
        this.language = language;
    }
} 