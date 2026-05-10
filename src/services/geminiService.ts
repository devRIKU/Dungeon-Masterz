import { GoogleGenAI, Type, Modality } from "@google/genai";

let ai: GoogleGenAI | null = null;
let currentAiKey = '';
let apiKey = '';

export function setApiKey(newKey: string) {
  console.log(`[Gemini] API Key set (length: ${newKey?.length || 0})`);
  apiKey = newKey;
}

export async function initializeGemini() {
  const currentKey = apiKey || '';
  
  if (!currentKey) {
    console.error("CRITICAL ERROR: Gemini API Key is missing! Please provide one in the settings.");
    // Return a dummy client that will fail gracefully or prompt for key
    return new GoogleGenAI({ apiKey: 'missing_key' });
  }
  
  console.log(`[Gemini] Initializing with key: ${currentKey.substring(0, 4)}...${currentKey.substring(currentKey.length - 4)}`);
  
  // Always create a new instance to ensure we pick up the latest key from the dialog
  return new GoogleGenAI({ apiKey: currentKey });
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
  isPermadeath?: boolean,
  modelName: string = "gemini-2.5-flash"
) {
  const aiClient = await initializeGemini();
  
  const model = modelName;
  
  const playerContext = players.map(p => 
    `${p.displayName} (from ${p.hometown || 'unknown'}, fear: ${p.fear || 'unknown'})`
  ).join(', ');

  const systemInstruction = `
    You are an expert Dungeon Master for a beautifully melancholic and mysterious adventure.
    
    Current Theme: ${theme}
    
    Setting Guidelines based on Theme:
    - fantasy: Deeply inspired by "Frieren: Beyond Journey's End" and "The Apothecary Diaries". Emphasize the passage of time, enduring memories, subtle and ancient magic, quiet melancholy, and the fleeting beauty of life. Incorporate meticulous deduction, medical herbalism, courtly intrigue, and quiet mysteries.
    - 80s: Inspired by "Stranger Things". 1984, small-town nostalgia, synth music, government conspiracy, Upside Down.
    - cyberpunk: Neon-drenched future, mega-corps, hacking, cybernetics, rain-slicked streets, high tech low life.
    - horror: Gothic horror, haunted mansions, eldritch terrors, survival, psychological tension.
    
    ${customSetting ? `Custom Adventure Setting: ${customSetting}` : ''}
    ${isHardMode ? `Difficulty: HARD MODE. Challenges are more lethal, resources are scarce, and success is harder to achieve.` : ''}
    ${isPermadeath ? `Mode: PERMADEATH. If a character dies, they are gone for good. The stakes are absolute.` : ''}

    Players:
    - The current party consists of: ${playerContext}.
    - Incorporate their fears into the narrative delicately.
    
    General Guidelines:
    - The narrative should be atmospheric, thoughtful, and occasionally action-packed, favoring quiet contemplation over constant combat.
    - **PACING**: Keep the pacing slow, deliberate, and deeply atmospheric. Give time to appreciate small moments.
    - **START**: Begin with a peaceful scene that slowly hints at mystery, lost history, or a subtle anomaly.
    - **PLACES**: Describe environments with care, emphasizing age, history, nature, and the subtle traces of people who lived there.
    - **COMMUNICATION**: Determine "signalStrength" (0.0 to 1.0).
    - **CUSTOM ACTIONS**: Incorporate player custom actions gracefully.
    - **NPCs**: Introduce and manage NPCs with rich, albeit sometimes hidden, inner lives.
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
      responseSchema: STORY_SCHEMA
    }
  });

  const responseText = response.text || "{}";
  try {
    return JSON.parse(responseText);
  } catch (parseError) {
    console.error("Failed to parse JSON from Gemini:", responseText);
    throw new Error("Failed to parse response from DM. The AI may have gotten confused.");
  }
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
  // Try Puter.js first
  if (typeof window !== 'undefined' && (window as any).puter) {
    try {
      const puter = (window as any).puter;
      
      // Auto sign into puter using the currently logged in google account if needed
      // Note: puter.auth.signIn() will prompt the user if not signed in
      if (!puter.auth.isSignedIn()) {
        await puter.auth.signIn();
      }

      // Add a timeout to puter fetch
      const puterPromise = puter.ai.txt2speech(
        `Deliver this in a slow, ethereal, and hauntingly mysterious voice, as if speaking from another dimension: ${text}`,
        { model: 'gemini-3.1-flash-tts-preview', voice: 'Charon' }
      );
      
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Puter TTS timeout")), 15000));
      const audioResult: any = await Promise.race([puterPromise, timeoutPromise]);
      
      if (audioResult instanceof HTMLAudioElement || (audioResult && typeof audioResult.play === 'function')) {
        return audioResult as HTMLAudioElement;
      }
      
      let blob: Blob;
      if (audioResult instanceof Blob) {
        blob = audioResult;
      } else if (audioResult instanceof ArrayBuffer) {
        blob = new Blob([audioResult]);
      } else if (typeof audioResult === 'string' || audioResult?.src) {
        const url = typeof audioResult === 'string' ? audioResult : audioResult.src;
        const resp = await fetch(url);
        blob = await resp.blob();
      } else if (audioResult?.blob) {
        // if it has a blob method
        blob = typeof audioResult.blob === 'function' ? await audioResult.blob() : await audioResult.blob;
      } else {
        throw new Error("Unknown Puter TTS return type");
      }

      // Convert blob to base64
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn("Puter.js TTS failed, falling back to direct API:", err);
    }
  }

  // Fallback to direct SDK
  const aiClient = await initializeGemini();
  
  const response = await aiClient.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
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
