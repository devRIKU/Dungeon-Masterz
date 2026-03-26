import { GoogleGenAI, Type, Modality } from "@google/genai";

let ai: GoogleGenAI | null = null;
let apiKey = '';

export async function initializeGemini() {
  if (ai) return ai;
  
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const data = await response.json();
      apiKey = data.geminiApiKey || '';
    }
  } catch (error) {
    console.warn("Failed to fetch config from backend, falling back to env vars if available");
  }
  
  // Fallback to import.meta.env if running purely client-side without the backend
  if (!apiKey) {
    // We initialize with a dummy key so the app doesn't crash on load, but it will fail on use
    console.error("CRITICAL ERROR: GEMINI_API_KEY is missing! Please set it in your environment variables.");
    ai = new GoogleGenAI({ apiKey: 'missing_key' });
  } else {
    ai = new GoogleGenAI({ apiKey });
  }
  
  return ai;
}

const STORY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: {
      type: Type.STRING,
      description: "The narrative text for the current part of the story."
    },
    signalStrength: {
      type: Type.NUMBER,
      description: "The current signal strength for walkie-talkies/communication (0.0 to 1.0). 0 means jammed or too far, 1 means clear."
    },
    choices: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING }
        },
        required: ["id", "text"]
      },
      description: "A dynamic list of choices for the player."
    },
    npcs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          photoURL: { type: Type.STRING },
          isNearby: { type: Type.BOOLEAN }
        },
        required: ["id", "name", "description", "isNearby"]
      },
      description: "Characters currently in the story."
    }
  },
  required: ["text", "choices", "signalStrength"]
};

export async function generateStoryPart(
  history: any[], 
  players: any[], 
  lastChoice?: string, 
  customAction?: string, 
  theme: string = '80s',
  customSetting?: string,
  isHardMode?: boolean,
  isPermadeath?: boolean
) {
  const aiClient = await initializeGemini();
  
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please configure it in your Netlify environment variables and trigger a rebuild.");
  }
  const model = "gemini-3-flash-preview";
  
  const playerContext = players.map(p => 
    `${p.displayName} (from ${p.hometown || 'unknown'}, fear: ${p.fear || 'unknown'})`
  ).join(', ');

  const systemInstruction = `
    You are an expert Dungeon Master for a supernatural adventure.
    
    Current Theme: ${theme}
    
    Setting Guidelines based on Theme:
    - 80s: Inspired by "Stranger Things". 1984, small-town nostalgia, synth music, government conspiracy, Upside Down.
    - fantasy: High fantasy, dragons, magic, ancient ruins, dark lords, epic quests.
    - cyberpunk: Neon-drenched future, mega-corps, hacking, cybernetics, rain-slicked streets, high tech low life.
    - horror: Gothic horror, haunted mansions, eldritch terrors, survival, psychological tension.
    
    ${customSetting ? `Custom Adventure Setting: ${customSetting}` : ''}
    ${isHardMode ? `Difficulty: HARD MODE. Challenges are more lethal, resources are scarce, and success is harder to achieve.` : ''}
    ${isPermadeath ? `Mode: PERMADEATH. If a character dies, they are gone for good. The stakes are absolute.` : ''}

    Players:
    - The current party consists of: ${playerContext}.
    - Incorporate their fears into the narrative.
    
    General Guidelines:
    - The narrative should be eerie, mysterious, and occasionally action-packed.
    - **PACING**: Keep the pacing slow and deliberate.
    - **START**: Begin with a peaceful scene that slowly hints at mystery.
    - **PLACES**: Use Google Search for real-world details if relevant.
    - **COMMUNICATION**: Determine "signalStrength" (0.0 to 1.0).
    - **CUSTOM ACTIONS**: Incorporate player custom actions.
    - **NPCs**: Introduce and manage NPCs.
    - Respond strictly in JSON format matching the provided schema.
  `;

  const prompt = customAction
    ? `The player performs a custom action: "${customAction}". Incorporate this into the story and provide new choices.`
    : lastChoice 
      ? `The player chose: "${lastChoice}". Continue the story and provide new choices.`
      : `Start a new ${theme} D&D adventure. Set the scene and provide the first set of choices. Begin peacefully.`;

  const contents = history.map(node => ({
    role: node.authorId === 'ai' ? 'model' : 'user',
    parts: [{ text: node.text }]
  }));

  if (contents.length === 0) {
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });
  } else if (lastChoice || customAction) {
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });
  }

  const response = await aiClient.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: STORY_SCHEMA,
      tools: [{ googleSearch: {} }]
    }
  });

  return JSON.parse(response.text);
}

export async function generateImage(prompt: string, aspectRatio: "1:1" | "16:9" | "9:16" = "1:1") {
  const width = aspectRatio === "16:9" ? 1280 : aspectRatio === "9:16" ? 720 : 800;
  const height = aspectRatio === "16:9" ? 720 : aspectRatio === "9:16" ? 1280 : 800;
  
  // Create a stable seed from the prompt to get consistent images for the same scene
  const seed = prompt.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const type = prompt.toLowerCase().includes('character') ? 'person' : 'adventure';
  
  return `https://picsum.photos/seed/${type}-${seed}/${width}/${height}`;
}

export async function generateAudio(text: string) {
  const aiClient = await initializeGemini();
  
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please configure it in your Netlify environment variables and trigger a rebuild.");
  }
  const response = await aiClient.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Deliver this in a slow, ethereal, and hauntingly mysterious voice, as if speaking from another dimension: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Charon' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio || null;
}
