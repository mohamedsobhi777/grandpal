/**
 * GrandPal Voice Processor
 * Handles voice command interpretation and execution using an LLM.
 */

import { exec, spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

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

    constructor() {
        this.loadUserPreferences();
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
    }

    /**
     * Process a voice command using Anthropic's Claude model.
     */
    async processCommand(command: string): Promise<VoiceResponse> {
        console.log("Processing command with LLM:", command);
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
            const messages: Anthropic.MessageParam[] = [...this.conversationHistory.map((item) => ({ role: item.role, content: item.content }))];
            const response = await this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20240620", // Using the specified powerful model
                max_tokens: 1024,
                system: systemPrompt,
                messages: messages,
                tool_choice: { type: "auto" },
                tools: this.getAvailableTools(),
            });

            console.log("LLM response:", JSON.stringify(response, null, 2));

            return await this.handleLLMResponse(response);
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
        let assistantResponse = "";
        let toolCall: Anthropic.Messages.ToolUseBlock | null = null;

        response.content.forEach((block) => {
            if (block.type === "text") {
                assistantResponse += block.text;
            } else if (block.type === "tool_use") {
                toolCall = block;
            }
        });

        // Add the assistant's text response to history
        if (assistantResponse) {
            this.conversationHistory.push({ role: "assistant", content: assistantResponse });
        }

        if (toolCall) {
            console.log(`Executing tool: ${toolCall.name}`);
            try {
                const toolResult = await this.executeTool(toolCall.name, toolCall.input);

                // We could send the result back to the model for a more informed response,
                // but for now, we'll just use the initial text and execute the action.
                return {
                    response: assistantResponse || toolResult.response,
                    action: toolCall.name,
                    success: toolResult.success,
                    data: toolResult.data,
                };
            } catch (error) {
                return {
                    response: assistantResponse || `I had trouble using my ${toolCall.name} tool.`,
                    action: "error",
                    success: false,
                };
            }
        }

        // If no tool use, just return the text response
        return {
            response: assistantResponse,
            action: "none",
            success: true,
        };
    }

    private async executeTool(toolName: string, input: any): Promise<any> {
        switch (toolName) {
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
        return `You are GrandPal, a friendly, patient, and kind voice assistant for elderly users. Your personality is like a loving grandparent. Be warm, encouraging, and simple in your language. Keep your responses concise.

    You have access to a set of tools to help the user with tasks on their computer. When the user's request requires one of these tools, you must use it. Respond with a JSON object containing both a natural language 'response' for the user and the specific 'action' to be taken.

    If the user's request matches one of your tool's capabilities, you MUST call that tool with the correct parameters. Do not just provide a text response suggesting you can do it; you must invoke the tool.

    For example, if the user says "show me my pictures," call the 'open_photos' tool. If they say "what's the weather like?", call the 'check_weather' tool.

    If the user is just chatting, you don't need to use a tool. Just provide a warm, conversational response.

    Today's date is ${new Date().toDateString()}. The user's operating system is ${os.platform()}.`;
    }

    private getAvailableTools(): Anthropic.Tool[] {
        return [
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
                description: "Opens the user's default email client.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "check_weather",
                description: "Opens a browser to search for the local weather forecast.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "search_internet",
                description: "Searches the internet for a given query.",
                input_schema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "The search term." },
                    },
                    required: ["query"],
                },
            },
            {
                name: "open_file_or_folder",
                description: "Opens a specified file or folder path.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "The full path to the file or folder." },
                    },
                    required: ["path"],
                },
            },
            {
                name: "open_application",
                description: "Opens a specific application by name.",
                input_schema: {
                    type: "object",
                    properties: {
                        application_name: { type: "string", description: "The name of the application to open (e.g., 'Calculator', 'Notepad')." },
                    },
                    required: ["application_name"],
                },
            },
        ];
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
            await this.openBrowserSearch("weather forecast");
            return {
                response: "Of course! Let me check the weather for you.",
                action: "check_weather",
                success: true,
            };
        } catch (error) {
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
        try {
            let command: string;
            if (process.platform === "darwin") {
                command = `say -v "Samantha" "${text}"`;
            } else if (process.platform === "win32") {
                command = `powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text}');"`;
            } else {
                command = `espeak "${text}"`;
            }
            exec(command);
            return true;
        } catch (error) {
            console.error("TTS execution failed:", error);
            return false;
        }
    }
}
