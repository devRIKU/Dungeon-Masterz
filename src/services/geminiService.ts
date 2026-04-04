import { GoogleGenAI, Type, Modality } from "@google/genai";

let ai: GoogleGenAI | null = null;
let currentAiKey = '';
let apiKey = '';

export let currentProvider: 'gemini' | 'groq' | 'openrouter' = 'gemini';
export let currentModel: string = 'gemini-2.5-flash';
export let groqKey = '';
export let openRouterKey = '';

type StoryResult = {
  text: string;
  signalStrength: number;
  choices: { id: string; text: string }[];
  npcs?: {
    id: string;
    name: string;
    description: string;
    photoURL?: string;
    isNearby: boolean;
  }[];
};

export function setApiKey(newKey: string) {
  const trimmedKey = newKey?.trim() || '';
  console.log(`[Gemini] API Key set (length: ${trimmedKey.length})`);
  apiKey = trimmedKey;
}

export function setAiConfig(provider: string, model: string, gKey: string, orKey: string) {
  currentProvider = provider as any;
  currentModel = model || 'gemini-2.5-flash';
  groqKey = gKey?.trim() || '';
  openRouterKey = orKey?.trim() || '';
}

export async function initializeGemini() {
  const currentKey = apiKey || '';

  if (currentProvider === 'gemini' && !currentKey) {
    throw new Error("Gemini API key is missing. Add one in Settings before starting the adventure.");
  }
  if (currentProvider === 'groq' && !groqKey) {
    throw new Error("Groq API key is missing. Add one in Settings.");
  }
  if (currentProvider === 'openrouter' && !openRouterKey) {
    throw new Error("OpenRouter API key is missing. Add one in Settings.");
  }

  // Recreate the client whenever the key changes so we always use the latest saved value.
  if (currentProvider === 'gemini') {
    if (!ai || currentAiKey !== currentKey) {
      ai = new GoogleGenAI({ apiKey: currentKey });
      currentAiKey = currentKey;
    }
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

function normalizeStoryResult(raw: unknown): StoryResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error("Gemini returned an empty story response.");
  }

  const candidate = raw as Partial<StoryResult>;
  const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
  const signalStrength =
    typeof candidate.signalStrength === 'number'
      ? Math.min(1, Math.max(0, candidate.signalStrength))
      : 1;

  const choices = Array.isArray(candidate.choices)
    ? candidate.choices
        .filter((choice) => !!choice && typeof choice === 'object')
        .map((choice, index) => ({
          id:
            typeof (choice as { id?: unknown }).id === 'string' &&
            (choice as { id?: string }).id?.trim()
              ? (choice as { id: string }).id
              : `choice-${index + 1}`,
          text:
            typeof (choice as { text?: unknown }).text === 'string'
              ? (choice as { text: string }).text.trim()
              : '',
        }))
        .filter((choice) => choice.text.length > 0)
    : [];

  const npcs = Array.isArray(candidate.npcs)
    ? candidate.npcs
        .filter((npc): npc is NonNullable<StoryResult['npcs']>[number] => !!npc && typeof npc === 'object')
        .map((npc, index) => ({
          id: typeof npc.id === 'string' && npc.id.trim() ? npc.id : `npc-${index + 1}`,
          name: typeof npc.name === 'string' ? npc.name.trim() : 'Unknown',
          description: typeof npc.description === 'string' ? npc.description.trim() : '',
          photoURL: typeof npc.photoURL === 'string' ? npc.photoURL : undefined,
          isNearby: Boolean(npc.isNearby),
        }))
    : [];

  if (!text) {
    throw new Error("Gemini returned a story without narrative text.");
  }

  return {
    text,
    signalStrength,
    choices:
      choices.length > 0
        ? choices
        : [
            { id: 'choice-1', text: 'Investigate the strange noise' },
            { id: 'choice-2', text: 'Stay together and look for clues' },
            { id: 'choice-3', text: 'Retreat and make a careful plan' },
          ],
    npcs,
  };
}

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
  await initializeGemini();

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
    - **COMMUNICATION**: Determine "signalStrength" (0.0 to 1.0).
    - **CUSTOM ACTIONS**: Incorporate player custom actions.
    - **NPCs**: Introduce and manage NPCs.
    - Respond strictly in JSON format matching the provided schema.

    REQUIRED SCHEMA FORMAT:
    {
      "text": "The narrative text...",
      "signalStrength": 1.0,
      "choices": [{"id": "1", "text": "Choice 1"}],
      "npcs": [{"id": "npc1", "name": "Name", "description": "Desc", "isNearby": true}]
    }
    ONLY return a valid JSON object. Do not include markdown or codeblocks.
  `;

  const prompt = customAction
    ? `The player performs a custom action: "${customAction}". Incorporate this into the story and provide new choices.`
    : lastChoice 
      ? `The player chose: "${lastChoice}". Continue the story and provide new choices.`
      : `Start a new ${theme} D&D adventure. Set the scene and provide the first set of choices. Begin peacefully.`;

  try {
    if (currentProvider === 'gemini') {
      const contents = history.map(node => ({
        role: node.authorId === 'ai' ? 'model' : 'user',
        parts: [{ text: node.text }]
      }));

      if (contents.length === 0 || lastChoice || customAction) {
        contents.push({ role: 'user', parts: [{ text: prompt }] });
      }

      const response = await ai!.models.generateContent({
        model: currentModel,
        contents,
        config: {
          systemInstruction,
          temperature: 0.8,
          responseMimeType: "application/json",
          responseSchema: STORY_SCHEMA,
        }
      });

      const rawText = response.text?.trim();
      if (!rawText) throw new Error("Gemini returned an empty response.");
      return normalizeStoryResult(JSON.parse(rawText));
    } else {
      // Groq and OpenRouter
      const messages = [
        { role: "system", content: systemInstruction },
        ...history.map(node => ({
          role: node.authorId === 'ai' ? 'assistant' : 'user',
          content: node.text
        })),
      ];

      if (messages.length === 1 || lastChoice || customAction) {
        messages.push({ role: "user", content: prompt });
      }

      const url = currentProvider === 'groq' 
        ? "https://api.groq.com/openai/v1/chat/completions" 
        : "https://openrouter.ai/api/v1/chat/completions";

      const key = currentProvider === 'groq' ? groqKey : openRouterKey;

      const body = {
        model: currentModel,
        messages,
        temperature: 0.8,
        response_format: { type: "json_object" }
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      };

      if (currentProvider === 'openrouter') {
        headers["HTTP-Referer"] = window.location.origin;
        headers["X-Title"] = "Dungeon Masterz";
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${currentProvider} API error: ${err}`);
      }

      const data = await res.json();
      const rawText = data.choices?.[0]?.message?.content?.trim();
      if (!rawText) throw new Error(`${currentProvider} returned an empty response.`);
      return normalizeStoryResult(JSON.parse(rawText));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${currentProvider}] Story generation failed:`, message);
    throw new Error(`Story generation failed: ${message}`);
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
  const aiClient = await initializeGemini();

  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Gemini] Audio generation failed:", message);
    throw new Error(`Audio generation failed: ${message}`);
  }
}
