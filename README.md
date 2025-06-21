# 🎤 GrandPal Voice Assistant

A voice-only virtual assistant designed specifically for elderly users who may not be comfortable with traditional technology interfaces.

## Features

- **Voice-Only Interface**: Simple voice commands with spoken responses
- **Elderly-Friendly Design**: Slower speech, clear interface, patient responses
- **Multilingual Support**: English, Spanish, Chinese, and Hindi
- **System Integration**: Opens files, applications, and browsers
- **Humor & Warmth**: Friendly, grandparent-like personality
- **Accessibility**: Large buttons, high contrast, reduced motion options

## Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start GrandPal**:
   ```bash
   npm start
   ```

3. **Begin Voice Interaction**:
   - Click "Start Listening" button
   - Speak your command clearly
   - GrandPal will respond and perform actions

## Voice Commands

### Greetings
- "Hello GrandPal"
- "Good morning"
- "Hi there"

### Photos & Media
- "Show me my photos"
- "Open my pictures"
- "Find my images"

### Music
- "Play some music"
- "Open music player"
- "I want to hear songs"

### Email & Communication
- "Check my email"
- "Open mail"
- "Show me messages"

### Web Search
- "Search for [topic]"
- "Look up [information]"
- "Find [something] on the internet"

### Weather
- "What's the weather like?"
- "Check the forecast"
- "Is it going to rain?"

### Files & Applications
- "Open my files"
- "Show me documents"
- "Open calculator"
- "Start notepad"

## Supported Languages

- **English** (Default)
- **Spanish** (Español)
- **Chinese** (中文)
- **Hindi** (हिन्दी)

Switch languages using the dropdown menu in the interface.

## How It Works

1. **Speech Recognition**: Uses browser's built-in Web Speech API for voice input
2. **Command Processing**: Analyzes voice commands using natural language patterns
3. **System Integration**: Executes system commands to open applications and files
4. **Text-to-Speech**: Responds using system TTS with elderly-friendly voice settings
5. **Memory**: Remembers user preferences and recent interactions

## Technical Architecture

- **Electron App**: Cross-platform desktop application
- **TypeScript**: Type-safe development
- **Voice Processing**: Natural language command interpretation
- **System Commands**: Direct integration with OS for file/app operations
- **Accessibility**: WCAG-compliant design principles

## Platform Support

- **macOS**: Full support with system TTS and application integration
- **Windows**: PowerShell TTS and Windows application support
- **Linux**: Basic support with espeak TTS

## Customization

GrandPal stores user preferences in `~/.grandpal-preferences.json`:

```json
{
  "language": "en",
  "voiceSpeed": "normal",
  "favoriteApps": [],
  "frequentSearches": []
}
```

## Development

### Project Structure
```
src/
├── index.ts          # Main Electron process
├── preload.ts        # Preload script for IPC
├── renderer.ts       # Voice interface
├── voice-processor.ts # Command processing logic
├── index.css         # Elderly-friendly styling
└── index.html        # Main window template
```

### Building
```bash
npm run make
```

### Packaging
```bash
npm run package
```

## Accessibility Features

- **Large Text**: 1.1rem minimum font size
- **High Contrast**: Support for high contrast mode
- **Reduced Motion**: Respects user's motion preferences
- **Voice Speed**: Adjustable speech rate (160-180 WPM)
- **Clear Visual Feedback**: Obvious listening states and button states

## Privacy & Security

- **Local Processing**: All voice processing happens locally
- **No Data Collection**: No user data is transmitted externally
- **File Permissions**: Only accesses user-specified directories
- **Secure IPC**: Isolated renderer process with context bridge

## Troubleshooting

### Voice Recognition Not Working
- Ensure microphone permissions are granted
- Check if browser supports Web Speech API
- Try using Chrome/Chromium browsers

### TTS Not Speaking
- Check system audio settings
- Ensure TTS services are available on your system
- Try different voices in system settings

### Applications Not Opening
- Verify application names match system applications
- Check if applications are installed in standard locations
- Try using full application paths

## Contributing

GrandPal is designed for rapid prototyping and hackathon development. Key areas for enhancement:

1. **Advanced NLP**: Integration with OpenAI or other LLM services
2. **Voice Training**: Personal voice recognition patterns
3. **More Integrations**: Calendar, contacts, smart home devices
4. **Better TTS**: ElevenLabs or similar for more natural voices
5. **Voice Analytics**: Understanding usage patterns for improvement

## License

MIT License - Feel free to adapt for your elderly users! 👴👵

---

*"Technology should adapt to people, not the other way around."* - GrandPal Philosophy # grandpal
