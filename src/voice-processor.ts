/**
 * GrandPal Voice Processor
 * Handles voice command interpretation and execution using an LLM.
 */

import { exec, spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import axios from "axios";
import { DeepgramSpeechService } from "./deepgram-service";
import { ipcMain } from "electron"; // Add for screenshot functionality
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

dotenv.config({ path: ".env" });

export interface VoiceResponse {
    response: string;
    action: string;
    success: boolean;
    data?: any;
}

export class VoiceProcessor {
    private userPreferences: any = {};
    private conversationHistory: { role: "user" | "assistant"; content: string }[] = [];
    private anthropic: Anthropic;
    private ttsProcess: ChildProcess | null = null;
    private speechService: DeepgramSpeechService | null = null;
    private elevenlabs: ElevenLabsClient | null = null;

    constructor(speechService?: DeepgramSpeechService) {
        this.loadUserPreferences();
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
        this.speechService = speechService || null;
        
        // Initialize ElevenLabs if API key is available
        if (process.env.ELEVENLABS_API_KEY) {
            this.elevenlabs = new ElevenLabsClient({
                apiKey: process.env.ELEVENLABS_API_KEY,
            });
        }
    }

    /**
     * Process a voice command using Anthropic's Claude model.
     */
    async processCommand(command: string, screenshot?: string): Promise<VoiceResponse> {
        console.log("Processing command with LLM:", command);
        if (screenshot) {
            console.log("Processing command with screenshot included");
        }
        
        if (!process.env.ANTHROPIC_API_KEY) {
            return {
                response: "My apologies, it seems I'm not configured correctly to use my advanced AI. Please set the ANTHROPIC_API_KEY.",
                action: "error",
                success: false,
            };
        }

        // Add the user's command to the history for context
        this.conversationHistory.push({ role: "user", content: command });
        if (this.conversationHistory.length > 10) {
            this.conversationHistory.shift(); // Keep history to a reasonable size
        }

        try {
            const systemPrompt = this.getSystemPrompt();
            
            // Prepare messages with optional screenshot
            const messages: Anthropic.MessageParam[] = [];
            
            // Add conversation history (text only)
            this.conversationHistory.slice(0, -1).forEach((item) => {
                messages.push({ role: item.role, content: item.content });
            });
            
            // Add the current command with optional screenshot
            if (screenshot) {
                // Extract base64 data from data URL
                const base64Data = screenshot.split(',')[1];
                const mediaType = screenshot.split(';')[0].split(':')[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
                
                messages.push({
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: command
                        },
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: mediaType,
                                data: base64Data
                            }
                        }
                    ]
                });
            } else {
                messages.push({ role: "user", content: command });
            }

            const initialResponse = await this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20240620",
                max_tokens: 1024,
                system: systemPrompt,
                messages: messages,
                tool_choice: { type: "auto" },
                tools: this.getAvailableTools(),
            });

            return await this.handleLLMResponse(initialResponse);
        } catch (error) {
            console.error("Error processing command with Anthropic:", error);
            return {
                response: "Oh dear, I seem to have gotten a bit confused. Could you try saying that again in a different way?",
                action: "error",
                success: false,
            };
        }
    }

    private async handleLLMResponse(response: Anthropic.Messages.Message): Promise<VoiceResponse> {
        let textResponse = "";
        const toolCalls: Anthropic.Messages.ToolUseBlock[] = [];

        response.content.forEach((block) => {
            if (block.type === "text") {
                textResponse += block.text;
            } else if (block.type === "tool_use") {
                toolCalls.push(block);
            }
        });

        if (textResponse) {
             this.conversationHistory.push({ role: "assistant", content: textResponse });
        }

        if (toolCalls.length > 0) {
            console.log(`Executing ${toolCalls.length} tool(s)...`);

            // Special handling for screenshot tool
            const screenshotTool = toolCalls.find(tool => tool.name === "take_screenshot");
            if (screenshotTool) {
                // Take screenshot and re-process the original command with the image
                const lastUserMessage = this.conversationHistory[this.conversationHistory.length - 2]?.content;
                if (lastUserMessage) {
                    try {
                        // We need to trigger a screenshot from the main process
                        // This is a bit tricky since we're in the voice processor
                        // For now, return a message asking the user to try again
                        return {
                            response: "I'd like to see your screen. Please say your request again and I'll be able to look at what you're showing me.",
                            action: "take_screenshot",
                            success: true,
                        };
                    } catch (error) {
                        console.error("Error handling screenshot:", error);
                        return {
                            response: "I'm having trouble seeing your screen right now. Could you describe what you're looking at instead?",
                            action: "error",
                            success: false,
                        };
                    }
                }
            }

            // Execute other tools normally
            const toolResults = await Promise.all(
                toolCalls.map(async (toolCall) => {
                    const result = await this.executeTool(toolCall.name, toolCall.input);
                    return {
                        type: "tool_result" as const,
                        tool_use_id: toolCall.id,
                        content: result.response, // The data to send back to the model
                    };
                })
            );

            // Step 3: Send the tool results back to the model
            const messages: Anthropic.MessageParam[] = [
                 ...this.conversationHistory.map((item) => ({ role: item.role, content: item.content })),
                 { role: "user", content: toolResults }
            ];

            const finalResponse = await this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20240620",
                max_tokens: 1024,
                system: this.getSystemPrompt(),
                messages: messages,
            });
            
            // For simplicity, we'll just return the final text response.
            // A more robust solution might handle further tool calls.
            let finalText = "";
            finalResponse.content.forEach(block => {
                if (block.type === "text") {
                    finalText += block.text;
                }
            });
            
            this.conversationHistory.push({ role: "assistant", content: finalText });

            return {
                response: finalText,
                action: "none",
                success: true,
            };
        }

        // If no tool use, just return the initial text response
        return {
            response: textResponse,
            action: "none",
            success: true,
        };
    }

    private async executeTool(toolName: string, input: any): Promise<any> {
        switch (toolName) {
            case "take_screenshot":
                return this.handleScreenshotRequest();
            case "open_photos":
                return this.handlePhotoRequest();
            case "open_music":
                return this.handleMusicRequest();
            case "open_email":
                return this.handleEmailRequest();
            case "check_weather":
                return this.handleWeatherRequest();
            case "search_internet":
                return this.handleSearchRequest(input.query);
            case "open_file_or_folder":
                return this.handleFileRequest(input.path);
            case "open_application":
                return this.handleApplicationRequest(input.application_name);
            default:
                return {
                    response: `I don't know how to use the tool: ${toolName}`,
                    success: false,
                };
        }
    }

    private getSystemPrompt(): string {
        return `You are GrandPal, a brief and friendly voice assistant. This is a VOICE conversation - keep ALL responses extremely short, like talking to a friend.

Critical rules:
- Maximum 1-2 sentences per response
- Speak naturally like you're talking, not writing
- Never use bullet points, lists, or long explanations
- Be warm but concise
- Act immediately when asked to do something

Voice examples:
- User: "Show me my pictures" -> "Opening your photos now!"
- User: "What's the weather?" -> "It's 72 degrees and sunny today."
- User: "What's on my screen?" -> "I can see your desktop with several folders open."
- User: "I'm lonely" -> "I'm here with you. Want to chat?"

Always use tools when requested. Never explain what you CAN do - just do it.

Today is ${new Date().toDateString()}.`;
    }

    private getAvailableTools(): Anthropic.Tool[] {
        return [
            {
                name: "take_screenshot",
                description: "Takes a screenshot of the user's screen to see what they're looking at. Use this when the user asks you to look at their screen or see what's displayed.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "open_photos",
                description: "Opens the user's default photo library.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "open_music",
                description: "Opens the user's default music application.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "open_email",
                description: "Opens the user's default email application.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "check_weather",
                description: "Gets the current weather for the user's location.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "search_internet",
                description: "Searches the internet for information.",
                input_schema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "The search query" },
                    },
                    required: ["query"],
                },
            },
            {
                name: "open_file_or_folder",
                description: "Opens a specific file or folder on the user's computer.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "The path to the file or folder" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "open_application",
                description: "Opens a specific application on the user's computer.",
                input_schema: {
                    type: "object",
                    properties: {
                        application_name: { type: "string", description: "The name of the application to open" },
                    },
                    required: ["application_name"],
                },
            },
        ];
    }

    private async handleScreenshotRequest(): Promise<VoiceResponse> {
        try {
            // Note: This is a placeholder. In a real implementation, this would trigger
            // the screenshot capture in the main process and return the image data.
            // For now, we'll return a success message indicating the screenshot was taken.
            return {
                response: "I can see your screen now. Let me take a look at what you're showing me.",
                action: "take_screenshot",
                success: true,
                data: { screenshot_taken: true }
            };
        } catch (error) {
            console.error("Error taking screenshot:", error);
            return {
                response: "I'm having trouble seeing your screen right now. Could you try again?",
                action: "error",
                success: false,
            };
        }
    }

    private async handlePhotoRequest(): Promise<VoiceResponse> {
        try {
            const photosPath = this.getPhotosDirectory();

            const openCommand = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

            exec(`${openCommand} "${photosPath}"`);

            return {
                response: "Let me open your photos for you!",
                action: "open_photos",
                success: true,
                data: { path: photosPath },
            };
        } catch (error) {
            return {
                response: "Oh my, I'm having trouble finding your photos.",
                action: "error",
                success: false,
            };
        }
    }

    private async handleMusicRequest(): Promise<VoiceResponse> {
        try {
            let musicApp = "";
            let openCommand = "";

            if (process.platform === "darwin") {
                musicApp = "Music";
                openCommand = `open -a "${musicApp}"`;
            } else if (process.platform === "win32") {
                musicApp = "Microsoft.ZuneMusic:";
                openCommand = `start ${musicApp}`;
            } else {
                musicApp = "rhythmbox";
                openCommand = musicApp;
            }

            exec(openCommand);

            return {
                response: "Music is food for the soul! Let me open your music player.",
                action: "open_music",
                success: true,
                data: { app: musicApp },
            };
        } catch (error) {
            return {
                response: "I'm having a little trouble with the music player, dear.",
                action: "error",
                success: false,
            };
        }
    }

    private async handleEmailRequest(): Promise<VoiceResponse> {
        try {
            let emailCommand = "";

            if (process.platform === "darwin") {
                emailCommand = "open -a Mail";
            } else if (process.platform === "win32") {
                emailCommand = "start mailto:";
            } else {
                emailCommand = "xdg-email";
            }

            exec(emailCommand);

            return {
                response: "Let me open your email for you!",
                action: "open_email",
                success: true,
            };
        } catch (error) {
            return {
                response: "I'm having trouble opening your email application.",
                action: "error",
                success: false,
            };
        }
    }

    private async handleWeatherRequest(): Promise<VoiceResponse> {
        try {
            const ip = await this.getPublicIp();
            const location = await this.getLocationFromIp(ip);
            const weather = await this.getWeatherForLocation(location);

            const response = `Right now in ${location.city}, it's ${weather.temperature}°C and ${weather.description}.`;

            return {
                response: response,
                action: "check_weather",
                success: true,
            };
        } catch (error) {
            console.error("Weather check failed:", error);
            return {
                response: "I'm having a bit of trouble getting the weather right now.",
                action: "error",
                success: false,
            };
        }
    }

    private async handleSearchRequest(query: string): Promise<VoiceResponse> {
        if (!query) {
            return {
                response: "What would you like me to search for, dear?",
                action: "prompt_user",
                success: false,
            };
        }
        try {
            await this.openBrowserSearch(query);
            return {
                response: `I'll search for "${query}" for you.`,
                action: "search_internet",
                success: true,
            };
        } catch (error) {
            return {
                response: "I'm having a little trouble searching right now.",
                action: "error",
                success: false,
            };
        }
    }

    private async handleFileRequest(filePath: string): Promise<VoiceResponse> {
        if (!filePath) {
            return {
                response: "Which file or folder should I open for you?",
                action: "prompt_user",
                success: false,
            };
        }

        try {
            const openCommand = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

            exec(`${openCommand} "${filePath}"`);

            return {
                response: `Opening ${path.basename(filePath)} for you.`,
                action: "open_file_or_folder",
                success: true,
            };
        } catch (error) {
            console.error(`Could not open file: ${filePath}`, error);
            return {
                response: "I'm sorry, I couldn't seem to open that file.",
                action: "error",
                success: false,
            };
        }
    }

    private async handleApplicationRequest(appName: string): Promise<VoiceResponse> {
        if (!appName) {
            return {
                response: "Which application should I open for you?",
                action: "prompt_user",
                success: false,
            };
        }

        try {
            let openCommand = "";
            if (process.platform === "darwin") {
                openCommand = `open -a "${appName}"`;
            } else if (process.platform === "win32") {
                openCommand = `start ${appName}`;
            } else {
                openCommand = appName.toLowerCase();
            }

            exec(openCommand, (error) => {
                if (error) {
                    console.error(`Failed to open application ${appName}:`, error);
                }
            });

            return {
                response: `Opening ${appName} for you.`,
                action: "open_application",
                success: true,
            };
        } catch (error) {
            console.error(`Could not open application: ${appName}`, error);
            return {
                response: `I'm sorry, I couldn't seem to open ${appName}.`,
                action: "error",
                success: false,
            };
        }
    }

    private getPhotosDirectory(): string {
        const homeDir = os.homedir();
        switch (process.platform) {
            case "darwin":
                return path.join(homeDir, "Pictures", "Photos Library.photoslibrary");
            case "win32":
                return path.join(homeDir, "Pictures");
            default:
                return path.join(homeDir, "Pictures");
        }
    }

    private async openBrowserSearch(query: string): Promise<void> {
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://www.google.com/search?q=${encodedQuery}`;

        const openCommand = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

        exec(`${openCommand} "${searchUrl}"`);
    }

    private async loadUserPreferences(): Promise<void> {
        // Stub for future implementation
        this.userPreferences = {
            name: "dear",
        };
    }

    async speakText(text: string, language = "en"): Promise<boolean> {
        this.stopSpeaking(); // Stop any currently speaking process

        // Pause speech recognition before starting TTS
        if (this.speechService) {
            this.speechService.pauseListening();
        }

        try {
            // Try ElevenLabs TTS first if available
            if (this.elevenlabs && process.env.ELEVENLABS_API_KEY) {
                console.log("Using ElevenLabs TTS with voice ID: NOpBlnGInO9m6vDvFkFC");
                
                try {
                    const audioStream = await this.elevenlabs.textToSpeech.convert("NOpBlnGInO9m6vDvFkFC", {
                        text: text,
                        modelId: "eleven_monolingual_v1",
                        voiceSettings: {
                            stability: 0.5,
                            similarityBoost: 0.75,
                            style: 0.0,
                            useSpeakerBoost: true
                        }
                    });

                    // Create a temporary file to play the audio
                    const tempDir = os.tmpdir();
                    const tempFile = path.join(tempDir, `grandpal_tts_${Date.now()}.mp3`);

                    // Write the audio stream to a file
                    const chunks: Buffer[] = [];
                    const reader = audioStream.getReader();
                    let done = false;
                    while (!done) {
                        const { value, done: readerDone } = await reader.read();
                        if (value) chunks.push(Buffer.from(value));
                        done = readerDone;
                    }
                    const audioBuffer = Buffer.concat(chunks);
                    await fs.writeFile(tempFile, audioBuffer);

                    // Play the audio file
                    let playCommand: string;
                    if (process.platform === "darwin") {
                        playCommand = `afplay "${tempFile}"`;
                    } else if (process.platform === "win32") {
                        playCommand = `powershell -Command "(New-Object Media.SoundPlayer '${tempFile}').PlaySync()"`;
                    } else {
                        playCommand = `aplay "${tempFile}"`;
                    }

                    this.ttsProcess = exec(playCommand, async (error) => {
                        if (error && !error.killed) {
                            console.error("TTS playback error:", error);
                        }
                        
                        // Clean up temp file
                        try {
                            await fs.unlink(tempFile);
                        } catch (unlinkError) {
                            console.warn("Could not clean up temp file:", unlinkError);
                        }
                        
                        this.ttsProcess = null;
                        
                        // Resume speech recognition after TTS finishes
                        if (this.speechService) {
                            // Add a small delay to ensure TTS audio has cleared
                            setTimeout(() => {
                                this.speechService?.resumeListening();
                            }, 500);
                        }
                    });
                    
                    return true;
                } catch (elevenLabsError) {
                    console.error("ElevenLabs TTS failed, falling back to system TTS:", elevenLabsError);
                    // Fall through to system TTS
                }
            }

            // Fallback to system TTS
            console.log("Using system TTS as fallback");
            let command: string;
            if (process.platform === "darwin") {
                command = `say -v "Samantha" "${text.replace(/"/g, '\\"')}"`;
            } else if (process.platform === "win32") {
                command = `powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text.replace(/'/g, "''")}')"`;
            } else {
                command = `espeak "${text.replace(/"/g, '\\"')}"`;
            }

            this.ttsProcess = exec(command, (error) => {
                if (error && !error.killed) {
                    console.error("TTS execution error:", error);
                }
                this.ttsProcess = null;
                
                // Resume speech recognition after TTS finishes
                if (this.speechService) {
                    // Add a small delay to ensure TTS audio has cleared
                    setTimeout(() => {
                        this.speechService?.resumeListening();
                    }, 500);
                }
            });
            return true;
        } catch (error) {
            console.error("TTS execution failed:", error);
            // Resume speech recognition even if TTS fails
            if (this.speechService) {
                this.speechService.resumeListening();
            }
            return false;
        }
    }

    private async getPublicIp(): Promise<string> {
        try {
            const response = await axios.get("https://api.ipify.org?format=json");
            return response.data.ip;
        } catch (error) {
            console.error("Could not get public IP:", error);
            throw new Error("Could not determine location.");
        }
    }

    private async getLocationFromIp(ip: string): Promise<any> {
        try {
            const response = await axios.get(`http://ip-api.com/json/${ip}`);
            if (response.data.status === 'fail') {
                throw new Error(response.data.message);
            }
            return response.data;
        } catch (error) {
            console.error("Could not get location from IP:", error);
            throw new Error("Could not determine location.");
        }
    }

    private async getWeatherForLocation(location: any): Promise<any> {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) {
            throw new Error("OpenWeather API key not set.");
        }
        try {
            const response = await axios.get(
                `https://api.openweathermap.org/data/2.5/weather?lat=${location.lat}&lon=${location.lon}&appid=${apiKey}&units=metric`
            );
            return {
                temperature: Math.round(response.data.main.temp),
                description: response.data.weather[0].description,
            };
        } catch (error) {
            console.error("Could not get weather data:", error);
            throw new Error("Could not get weather data.");
        }
    }

    stopSpeaking(): void {
        if (this.ttsProcess) {
            console.log("Stopping current speech.");
            this.ttsProcess.kill();
            this.ttsProcess = null;
            
            // Resume speech recognition when TTS is stopped
            if (this.speechService) {
                this.speechService.resumeListening();
            }
        }
    }
}
