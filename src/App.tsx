import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from '@firebase/auth';
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  History,
  Loader2,
  LogOut,
  Palette,
  Pen,
  Radio,
  Send,
  Settings,
  Shield,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SignalZero,
  Sparkles,
  Sword,
  Users,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react';
import { auth, signInWithGoogle } from './firebase';
import { motion, AnimatePresence } from './lib/motion';
import { soundManager } from './lib/sounds';
import { cn } from './lib/utils';
import StoryViewport from './components/StoryViewport';
import OptionDeck from './components/OptionDeck';
import {
  addHistoryNode,
  createGameInFirestore,
  joinGameInFirestore,
  sendChatMessage,
  subscribeToChat,
  subscribeToGame,
  subscribeToHistory,
  updateGameStateInFirestore,
} from './services/gameService';
import { generateAudio, generateImage, generateStoryPart, setApiKey, setAiConfig } from './services/geminiService';
import type { ChatMessage, GameState, Player, StoryChoice, StoryNode } from './types';

const THEME_OPTIONS = [
  'Fantasy',
  'Dark Fantasy',
  'High Fantasy',
  'Cyberpunk',
  'Steampunk',
  'Sci-Fi',
  'Space Opera',
  'Horror',
  'Cosmic Horror',
  'Gothic',
  'Noir',
  'Mystery',
  'Thriller',
  'Post-Apocalyptic',
  'Western',
  'Pirate',
  'Mythology',
  'Fairy Tale',
  'Urban Fantasy',
  'Superhero',
  'Dystopia',
  'Survival',
  'Comedy',
  '80s Retro',
  'Anime',
  'Lovecraftian',
  'Sword & Sorcery',
  'Wuxia',
  'Solarpunk',
  'Biopunk',
];

const AI_PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openrouter', label: 'OpenRouter (Free Models)' },
  { id: 'groq', label: 'Groq (Free Models)' },
] as const;

const MODELS_BY_PROVIDER = {
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemma-2-9b-it', label: 'Gemma 2 9B' },
    { id: 'gemma-2-27b-it', label: 'Gemma 2 27B' },
  ],
  openrouter: [
    { id: 'meta-llama/llama-3-8b-instruct:free', label: 'Llama 3 8B (Free)' },
    { id: 'google/gemma-7b-it:free', label: 'Gemma 7B (Free)' },
    { id: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B (Free)' },
    { id: 'open-chat/openchat-7b:free', label: 'OpenChat 7B (Free)' },
  ],
  groq: [
    { id: 'llama3-8b-8192', label: 'Llama 3 8B' },
    { id: 'llama3-70b-8192', label: 'Llama 3 70B' },
    { id: 'gemma2-9b-it', label: 'Gemma 2 9B' },
    { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  ]
};

const UI_THEMES = [
  { id: 'crimson',  label: 'Crimson',  color: '#c93535' },
  { id: 'blood',    label: 'Blood',    color: '#8a0303' },
  { id: 'rose',     label: 'Rose',     color: '#ec4899' },
  { id: 'neon-pink', label: 'Neon Pink', color: '#ff007f' },
  { id: 'synth',    label: 'Synth',    color: '#e600e6' },
  { id: 'violet',   label: 'Violet',   color: '#8b5cf6' },
  { id: 'void',     label: 'Void',     color: '#4b0082' },
  { id: 'amethyst', label: 'Amethyst', color: '#9966cc' },
  { id: 'catppuccin', label: 'Catppuccin', color: '#cba6f7'},
  { id: 'sapphire', label: 'Sapphire', color: '#3b82f6' },
  { id: 'arcane',   label: 'Arcane',   color: '#4682b4' },
  { id: 'frost',    label: 'Frost',    color: '#06b6d4' },
  { id: 'cyber',    label: 'Cyber',    color: '#00ffcc' },
  { id: 'emerald',  label: 'Emerald',  color: '#10b981' },
  { id: 'jade',     label: 'Jade',     color: '#00a86b' },
  { id: 'everforest', label: 'Everforest', color: '#a7c080'},
  { id: 'toxic',    label: 'Toxic',    color: '#39ff14' },
  { id: 'gold',     label: 'Gold',     color: '#eab308' },
  { id: 'ember',    label: 'Ember',    color: '#d97706' },
  { id: 'gruvbox',  label: 'Gruvbox',  color: '#fe8019'},
  { id: 'copper',   label: 'Copper',   color: '#b87333' },
  { id: 'slate',    label: 'Slate',    color: '#708090' },
  { id: 'obsidian', label: 'Obsidian', color: '#4a5054' },
] as const;

const garbleText = (text: string, strength: number) => {
  if (strength >= 0.95) return text;
  return text
    .split('')
    .map((char) => {
      if (char === ' ') return ' ';
      return Math.random() > strength ? (Math.random() > 0.5 ? '...' : '█') : char;
    })
    .join('');
};

const getFriendlyAiError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('api key') || normalized.includes('403') || normalized.includes('401') || normalized.includes('permission')) {
    return 'Your API key is missing, invalid, or does not have access. Update it in Settings and try again.';
  }
  if (normalized.includes('quota') || normalized.includes('rate limit') || normalized.includes('429')) {
    return 'The provider is rate-limiting this request right now. Wait a moment and try again.';
  }
  if (normalized.includes('model') || normalized.includes('unsupported')) {
    return 'The story model rejected the request. Try again with the saved settings.';
  }
  return message.length > 150 ? `${message.slice(0, 147)}...` : message;
};

function SignalBadge({ strength }: { strength: number }) {
  if (strength > 0.8) {
    return <span className="signal-badge"><SignalHigh className="h-4 w-4 text-emerald-400" />Signal: Clear</span>;
  }
  if (strength > 0.4) {
    return <span className="signal-badge"><SignalMedium className="h-4 w-4 text-amber-300" />Signal: Weak</span>;
  }
  if (strength > 0.1) {
    return <span className="signal-badge"><SignalLow className="h-4 w-4 text-orange-300" />Fragmented</span>;
  }
  return <span className="signal-badge"><SignalZero className="h-4 w-4 text-red-300" />Jammed</span>;
}

/* ──────────────────────────────────────────
   RunescribeLogo  — the star icon used everywhere
   ────────────────────────────────────────── */
function RunescribeLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
      <path d="M18 2l.5 1.5L20 4l-1.5.5L18 6l-.5-1.5L16 4l1.5-.5L18 2z" />
    </svg>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roomId, setRoomId] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [customActionInput, setCustomActionInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // API Models Config
  const [aiProvider, setAiProvider] = useState(() => localStorage.getItem('ai_provider') || 'gemini');
  const [aiModel, setAiModel] = useState(() => localStorage.getItem('ai_model') || 'gemini-2.5-flash');
  const [userApiKey, setUserApiKey] = useState('');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isNarrationActive, setIsNarrationActive] = useState(false);
  const [isGeneratingArt, setIsGeneratingArt] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isAdvSettingsOpen, setIsAdvSettingsOpen] = useState(false);
  const [uiTheme, setUiTheme] = useState(() => localStorage.getItem('ui_theme') || 'crimson');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const currentNode = gameState?.history?.[gameState.history.length - 1] ?? null;
  const currentTheme = gameState?.theme || '80s';
  const currentStoryText = currentNode?.text || gameState?.currentText || 'The veil is still.';
  const chapterNumber = Math.max(gameState?.history.length || 0, gameState?.status === 'active' ? 1 : 0);

  useEffect(() => {
    const cachedGeminiKey = localStorage.getItem('gemini_api_key');
    if (cachedGeminiKey) setUserApiKey(cachedGeminiKey);
    
    const cachedGroqKey = localStorage.getItem('groq_api_key');
    if (cachedGroqKey) setGroqApiKey(cachedGroqKey);
    
    const cachedOrKey = localStorage.getItem('openrouter_api_key');
    if (cachedOrKey) setOpenRouterApiKey(cachedOrKey);
  }, []);

  // Sync to lib
  useEffect(() => {
    setAiConfig(aiProvider, aiModel, groqApiKey, openRouterApiKey);
    if (userApiKey) setApiKey(userApiKey);
  }, [aiProvider, aiModel, userApiKey, groqApiKey, openRouterApiKey]);

  /* Apply UI theme to document root */
  useEffect(() => {
    const root = document.documentElement;
    if (uiTheme === 'crimson') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', uiTheme);
    }
    localStorage.setItem('ui_theme', uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setGameState(null);
        setRoomId('');
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!roomId) return;

    const unsubscribeGame = subscribeToGame(roomId, (state) => {
      setGameState((previous) => {
        if (!previous) return { ...state, history: [] };
        return { ...state, history: previous.history };
      });
    });

    const unsubscribeHistory = subscribeToHistory(roomId, (history) => {
      setGameState((previous) => {
        if (!previous) return null;
        return { ...previous, history };
      });
    });

    const unsubscribeChat = subscribeToChat(roomId, (nextMessages) => {
      setMessages((previous) => {
        if (nextMessages.length > previous.length) {
          soundManager.playMessage();
        }
        return nextMessages;
      });
    });

    return () => {
      unsubscribeGame();
      unsubscribeHistory();
      unsubscribeChat();
    };
  }, [roomId]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const ensureApiKey = () => {
    let hasKey = false;
    if (aiProvider === 'gemini') hasKey = !!userApiKey.trim();
    if (aiProvider === 'groq') hasKey = !!groqApiKey.trim();
    if (aiProvider === 'openrouter') hasKey = !!openRouterApiKey.trim();

    if (hasKey) return true;

    setIsSettingsOpen(true);
    setError(`An API key for ${AI_PROVIDERS.find(p => p.id === aiProvider)?.label} is required.`);
    soundManager.playError();
    return false;
  };

  const handlePlayAnonymous = () => {
    setIsAnonymous(true);
    setUser({
      uid: `anon-${Math.random().toString(36).slice(2, 9)}`,
      displayName: 'Nameless Wanderer',
      email: null,
      emailVerified: false,
      isAnonymous: true,
      metadata: {},
      providerData: [],
      refreshToken: '',
      tenantId: null,
      delete: async () => {},
      getIdToken: async () => '',
      getIdTokenResult: async () => ({} as never),
      reload: async () => {},
      toJSON: () => ({}),
      phoneNumber: null,
      photoURL: null,
    } as User);
    if (!ensureApiKey()) {
      setIsSettingsOpen(true);
    }
  };

  const handleSaveUserApiKey = async () => {
    setIsSavingApiKey(true);
    try {
      localStorage.setItem('ai_provider', aiProvider);
      localStorage.setItem('ai_model', aiModel);
      if (userApiKey.trim()) localStorage.setItem('gemini_api_key', userApiKey.trim());
      if (groqApiKey.trim()) localStorage.setItem('groq_api_key', groqApiKey.trim());
      if (openRouterApiKey.trim()) localStorage.setItem('openrouter_api_key', openRouterApiKey.trim());

      setAiConfig(aiProvider, aiModel, groqApiKey.trim(), openRouterApiKey.trim());
      if (userApiKey.trim()) setApiKey(userApiKey.trim());
      setIsSettingsOpen(false);
      soundManager.playSuccess();
    } catch (saveError) {
      console.error(saveError);
      setError('Failed to save settings.');
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const createGame = async () => {
    if (!user) return;
    setIsCreatingGame(true);

    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const player: Player = {
      uid: user.uid,
      displayName: user.displayName || 'Adventurer',
      photoURL: user.photoURL || undefined,
      isHost: true,
    };

    try {
      await createGameInFirestore(newRoomId, player);
      setRoomId(newRoomId);
      soundManager.playSuccess();
    } catch (createError) {
      console.error(createError);
      setError('Failed to create the room.');
      soundManager.playError();
    } finally {
      setIsCreatingGame(false);
    }
  };

  const joinGame = async () => {
    if (!user || !roomId.trim()) return;

    const player: Player = {
      uid: user.uid,
      displayName: user.displayName || 'Adventurer',
      photoURL: user.photoURL || undefined,
      isHost: false,
    };

    try {
      const success = await joinGameInFirestore(roomId.trim().toUpperCase(), player);
      if (success) {
        setRoomId(roomId.trim().toUpperCase());
        soundManager.playSuccess();
      } else {
        setError('No room answered that code.');
        soundManager.playError();
      }
    } catch (joinError) {
      console.error(joinError);
      setError('Failed to join the room.');
      soundManager.playError();
    }
  };

  const copyRoomCode = async () => {
    if (!roomId) return;
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    soundManager.playClick();
    window.setTimeout(() => setCopied(false), 1800);
  };

  const buildPlayerSnapshot = (players: Player[]) => players.map((player) => ({
    ...player,
    displayName: player.displayName || 'Adventurer',
  }));

  const startGame = async () => {
    if (!gameState || gameState.hostId !== user?.uid) return;
    if (!ensureApiKey()) return;

    await updateGameStateInFirestore(roomId, { isGenerating: true });
    try {
      const result = await generateStoryPart(
        [],
        buildPlayerSnapshot(gameState.players),
        undefined,
        undefined,
        currentTheme,
        gameState.customSetting,
        gameState.isHardMode,
        gameState.isPermadeath
      );

      const imagePrompt = `A cinematic ${currentTheme} scene with mysterious lighting and occult atmosphere: ${result.text.slice(0, 260)}`;
      const imageUrl = await generateImage(imagePrompt, '16:9');

      const newNode: StoryNode = {
        id: 'chapter-1',
        text: result.text,
        choices: result.choices,
        timestamp: Date.now(),
        authorId: 'ai',
        imageUrl: imageUrl || undefined,
      };

      await addHistoryNode(roomId, newNode);
      await updateGameStateInFirestore(roomId, {
        status: 'active',
        currentText: result.text,
        currentOptions: result.choices,
        signalStrength: result.signalStrength ?? 1,
        npcs: result.npcs || [],
        isGenerating: false,
      });
      soundManager.playSuccess();
    } catch (startError) {
      console.error(startError);
      setError(getFriendlyAiError(startError));
      await updateGameStateInFirestore(roomId, { isGenerating: false });
      soundManager.playError();
    }
  };

  const handleMakeChoice = async (choice?: StoryChoice, customAction?: string) => {
    if (!gameState || gameState.isGenerating) return;
    if (!ensureApiKey()) return;

    await updateGameStateInFirestore(roomId, { isGenerating: true });
    try {
      const result = await generateStoryPart(
        gameState.history,
        buildPlayerSnapshot(gameState.players),
        choice?.text,
        customAction,
        currentTheme,
        gameState.customSetting,
        gameState.isHardMode,
        gameState.isPermadeath
      );

      const imagePrompt = `A cinematic ${currentTheme} scene with deep shadows and dramatic atmosphere: ${result.text.slice(0, 260)}`;
      const imageUrl = await generateImage(imagePrompt, '16:9');

      const newNode: StoryNode = {
        id: Math.random().toString(36).slice(2, 9),
        text: result.text,
        choices: result.choices,
        timestamp: Date.now(),
        authorId: 'ai',
        choiceMade: customAction || choice?.text,
        imageUrl: imageUrl || undefined,
      };

      await addHistoryNode(roomId, newNode);
      await updateGameStateInFirestore(roomId, {
        currentText: result.text,
        currentOptions: result.choices,
        signalStrength: result.signalStrength ?? 1,
        npcs: result.npcs || gameState.npcs || [],
        isGenerating: false,
      });
      setCustomActionInput('');
      setIsNarrationActive(false);
      soundManager.stopVoice();
      soundManager.playSuccess();
    } catch (choiceError) {
      console.error(choiceError);
      setError(getFriendlyAiError(choiceError));
      await updateGameStateInFirestore(roomId, { isGenerating: false });
      soundManager.playError();
    }
  };

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chatInput.trim() || !user || !roomId) return;

    const text = chatInput.trim();
    setChatInput('');

    await sendChatMessage(roomId, {
      senderId: user.uid,
      senderName: user.displayName || 'Adventurer',
      text,
      timestamp: Date.now(),
    });

    const nearbyNpc = gameState?.npcs?.find(
      (npc) => npc.isNearby && text.toLowerCase().includes(`@${npc.name.toLowerCase()}`)
    );

    if (nearbyNpc) {
      void handleMakeChoice(undefined, `I say to ${nearbyNpc.name}: "${text}"`);
    }
  };

  const savePlayerProfile = async (updates: Partial<Player>) => {
    if (!gameState || !user) return;
    const players = gameState.players.map((player) => (
      player.uid === user.uid ? { ...player, ...updates } : player
    ));
    await updateGameStateInFirestore(roomId, { players });
  };

  const generateCharacterArt = async () => {
    if (!gameState || !user) return;
    if (!ensureApiKey()) return;

    const player = gameState.players.find((entry) => entry.uid === user.uid);
    if (!player) return;

    setIsGeneratingArt(true);
    try {
      const prompt = `A cinematic portrait in a ${currentTheme} world of ${player.displayName || 'an adventurer'} from ${
        player.hometown || 'an unknown place'
      }, haunted by ${player.fear || 'an unnamed dread'}.`;
      const artUrl = await generateImage(prompt, '1:1');
      if (artUrl) {
        await savePlayerProfile({ characterArtUrl: artUrl });
        soundManager.playSuccess();
      }
    } catch (artError) {
      console.error(artError);
      setError(getFriendlyAiError(artError));
      soundManager.playError();
    } finally {
      setIsGeneratingArt(false);
    }
  };

  const playStoryAudio = async () => {
    if (!gameState?.currentText) return;

    if (isNarrationActive) {
      soundManager.stopVoice();
      setIsNarrationActive(false);
      return;
    }

    setIsAudioLoading(true);
    try {
      const audio = await generateAudio(gameState.currentText);
      if (!audio) {
        throw new Error('Gemini returned empty audio data.');
      }
      await soundManager.playVoice(audio);
      setIsNarrationActive(true);
    } catch (audioError) {
      console.error(audioError);
      setError(getFriendlyAiError(audioError));
      setIsNarrationActive(false);
    } finally {
      setIsAudioLoading(false);
    }
  };

  const leaveCurrentGame = () => {
    soundManager.stopVoice();
    setIsNarrationActive(false);
    setGameState(null);
    setMessages([]);
    setRoomId('');
    setCustomActionInput('');
    setChatInput('');
  };

  const logout = async () => {
    leaveCurrentGame();
    if (isAnonymous) {
      setUser(null);
      setIsAnonymous(false);
      return;
    }
    await auth.signOut();
  };

  const myPlayer = useMemo(
    () => gameState?.players.find((player) => player.uid === user?.uid) || null,
    [gameState?.players, user?.uid]
  );

  /* ═══════════════════════════════════════════
     SCREEN 1 — SPLASH  (not logged in)
     ═══════════════════════════════════════════ */
  if (!user) {
    return (
      <div className="app-shell">
        <div className="landing-shell">
          {/* Logo */}
          <div className="landing-logo">
            <RunescribeLogo size={38} />
          </div>

          {/* Title + subtitle */}
          <div className="landing-copy">
            <h1 className="landing-title">Runescribe</h1>
            <p className="landing-subtitle">
              "Step into the realm of infinite stories, where every choice weaves a new destiny."
            </p>
          </div>

          {/* Action panel */}
          <div className="landing-panel">
            <input
              id="landing-api-key"
              type="password"
              value={userApiKey}
              onChange={(event) => setUserApiKey(event.target.value)}
              className="ritual-input"
              placeholder="Paste your Gemini API key"
            />

            <button
              type="button"
              onClick={async () => {
                if (userApiKey.trim()) {
                  handleSaveUserApiKey();
                }
                try {
                  await signInWithGoogle();
                } catch (loginError) {
                  console.error(loginError);
                  setError('Google sign-in failed.');
                }
              }}
              className="primary-button"
              style={{ width: '100%', padding: '0.9rem 1.2rem', borderRadius: 'var(--radius-md)' }}
            >
              <Shield className="h-4 w-4" />
              Begin Your Journey
            </button>

            <button type="button" onClick={handlePlayAnonymous} className="ghost-button"
              style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', justifyContent: 'center' }}
            >
              <Users className="h-4 w-4" />
              Play Anonymous
            </button>
          </div>

          {/* Footer badges */}
          <div className="landing-footer">
            <span><Users className="h-3 w-3" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.35rem' }} />MULTIPLAYER</span>
            <span className="landing-footer-dot" />
            <span><Sparkles className="h-3 w-3" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.35rem' }} />AI POWERED</span>
          </div>
        </div>

        {/* floating sparkle */}
        <div className="floating-sparkle">
          <Sparkles className="h-4 w-4" />
        </div>

        {error ? (
          <div className="toast toast--error">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  /* ═══════════════════════════════════════════
     SCREEN 2 — DASHBOARD  (logged in, no game)
     ═══════════════════════════════════════════ */
  if (!gameState) {
    return (
      <div className="app-shell">
        {/* Topbar with avatar */}
        <div className="topbar">
          <div className="topbar-user">
            <div style={{ position: 'relative' }}>
              <img
                src={user.photoURL || `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${user.uid}`}
                className="topbar-avatar"
                referrerPolicy="no-referrer"
                alt=""
              />
              <div className="topbar-avatar-status" />
            </div>
            <div>
              <p className="eyebrow">Adventurer</p>
              <h2 className="topbar-title" style={{ fontFamily: 'var(--font-sans)' }}>{user.displayName || 'Adventurer'}</h2>
            </div>
          </div>

          <div className="topbar-actions">
            <button type="button" onClick={() => setIsSettingsOpen(true)} className="icon-button">
              <Palette className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setIsHistoryOpen(true)} className="icon-button">
              <History className="h-4 w-4" />
            </button>
            <button type="button" onClick={logout} className="icon-button icon-button--danger">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="dashboard-content">
          {/* New Adventure card */}
          <button
            type="button"
            className="adventure-card"
            onClick={createGame}
            disabled={isCreatingGame}
            style={{ marginTop: '1.5rem' }}
          >
            <div className="adventure-card-copy">
              <h3>{isCreatingGame ? 'Forging the room...' : 'New Adventure'}</h3>
              <p>Embark on a personal quest through the unknown. Forge your own destiny.</p>
            </div>
            <div className="adventure-card-icon">
              {isCreatingGame ? <Loader2 className="h-10 w-10 animate-spin" /> : <RunescribeLogo size={64} />}
            </div>
          </button>

          {/* ── OR JOIN PARTY ── */}
          <div className="section-divider">
            <span className="section-divider-text">Or Join Party</span>
          </div>

          <div className="join-section">
            <input
              type="text"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              className="ritual-input"
            />
            <button type="button" onClick={joinGame} className="secondary-button">
              Join
            </button>
          </div>

          {/* ── API KEY ── */}
          <div className="section-divider">
            <span className="section-divider-text">API Key</span>
          </div>

          <div className="api-section">
            <p className="eyebrow">Personal Gemini API Key</p>
            <div className="api-row">
              <input
                type="password"
                value={userApiKey}
                onChange={(event) => setUserApiKey(event.target.value)}
                placeholder="Gemini API key"
                className="ritual-input"
              />
              <button type="button" onClick={handleSaveUserApiKey} className="primary-button" disabled={isSavingApiKey}>
                {isSavingApiKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'SAVE'}
              </button>
            </div>
            <p className="api-hint">Required to play. Synced securely with your account.</p>
          </div>
        </div>

        {/* Settings modal */}
        <AnimatePresence>
          {isSettingsOpen ? (
            <div className="overlay-shell">
              <div className="overlay-backdrop" onClick={() => setIsSettingsOpen(false)} />
              <motion.div className="modal-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="panel-heading-row">
                  <div>
                    <p className="eyebrow">Settings</p>
                    <h3 className="panel-title">Narration and access</h3>
                  </div>
                  <button type="button" className="icon-button" onClick={() => setIsSettingsOpen(false)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                  <input
                    type="password"
                    value={userApiKey}
                    onChange={(event) => setUserApiKey(event.target.value)}
                    className="ritual-input ritual-input--compact"
                    placeholder="Gemini API key"
                  />
                  <button type="button" onClick={handleSaveUserApiKey} className="primary-button" disabled={isSavingApiKey}>
                    {isSavingApiKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    Save key
                  </button>
                </div>

                {/* UI Theme picker */}
                <div style={{ marginTop: '1rem' }}>
                  <p className="theme-picker-label">UI Theme</p>
                  <div className="theme-swatch-grid">
                    {UI_THEMES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        title={t.label}
                        className={`theme-swatch ${uiTheme === t.id ? 'theme-swatch--active' : ''}`}
                        style={{ background: t.color }}
                        onClick={() => setUiTheme(t.id)}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>

        {error ? (
          <div className="toast toast--error">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  /* ═══════════════════════════════════════════
     SCREEN 3 — GAME (lobby + active)
     ═══════════════════════════════════════════ */
  return (
    <div className="app-shell">
      {/* === TOPBAR === */}
      <header className="topbar">
        <div className="topbar-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--ink)' }}>
            <RunescribeLogo size={20} />
            <h1 className="topbar-title" style={{ fontFamily: 'var(--font-sans)', fontSize: '1rem' }}>Runescribe</h1>
          </div>
          <button type="button" onClick={copyRoomCode} className="room-pill">
            <Radio className="h-3.5 w-3.5" style={{ color: '#22c55e' }} />
            {roomId}
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="topbar-actions">
          {gameState.status === 'active' && (
            <button type="button" onClick={playStoryAudio} className="icon-button" disabled={isAudioLoading || gameState.isGenerating}>
              {isAudioLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isNarrationActive ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          )}
          <button type="button" onClick={() => setIsHistoryOpen(true)} className="icon-button">
            <History className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setIsSettingsOpen(true)} className="icon-button">
            <Settings className="h-4 w-4" />
          </button>
          <button type="button" onClick={logout} className="icon-button icon-button--danger">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── LOBBY ── */}
      {gameState.status === 'lobby' ? (
        <>
          {/* Lobby info banner */}
          <div className="story-stage story-stage--landing" style={{ marginTop: '1rem' }}>
            <div className="story-stage-backdrop" />
            <div className="story-stage-overlay" />
            <div className="story-stage-inner" style={{ justifyContent: 'center', textAlign: 'center', alignItems: 'center' }}>
              <p className="eyebrow">Waiting for all companions</p>
              <h2 className="scene-title" style={{ maxWidth: '24ch' }}>The room is gathering breath.</h2>
              <p className="scene-subtitle" style={{ maxWidth: '42ch' }}>
                Shape your character, tune the setting, and let the host begin when the circle is ready.
              </p>
            </div>
          </div>

          <div className="lobby-layout">
            {/* Left column */}
            <div className="lobby-main">
              {/* Character profile */}
              <div className="profile-card">
                <div className="profile-card-header">
                  <div className="profile-card-header-icon">
                    <RunescribeLogo size={16} />
                  </div>
                  <div>
                    <h3>Character Profile</h3>
                    <p>Define your hero's identity</p>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-grid-2col">
                    <div>
                      <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Character Name</p>
                      <input
                        type="text"
                        defaultValue={myPlayer?.displayName || user.displayName || ''}
                        placeholder="Character name"
                        className="ritual-input ritual-input--compact"
                        onBlur={(event) => void savePlayerProfile({ displayName: event.target.value })}
                      />
                    </div>
                    <div>
                      <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Origin / Hometown</p>
                      <input
                        type="text"
                        defaultValue={myPlayer?.hometown || ''}
                        placeholder="Where are you from?"
                        className="ritual-input ritual-input--compact"
                        onBlur={(event) => void savePlayerProfile({ hometown: event.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Greatest Fear</p>
                    <input
                      type="text"
                      defaultValue={myPlayer?.fear || ''}
                      placeholder="What haunts your dreams?"
                      className="ritual-input ritual-input--compact"
                      onBlur={(event) => void savePlayerProfile({ fear: event.target.value })}
                    />
                  </div>

                  <div>
                    <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Character Portrait (URL)</p>
                    <div style={{ display: 'flex', gap: '0.65rem' }}>
                      <input
                        type="text"
                        defaultValue={myPlayer?.characterArtUrl || ''}
                        placeholder="https://..."
                        className="ritual-input ritual-input--compact"
                        style={{ flex: 1 }}
                        onBlur={(event) => void savePlayerProfile({ characterArtUrl: event.target.value })}
                      />
                      <button type="button" onClick={generateCharacterArt} className="primary-button" disabled={isGeneratingArt}
                        style={{ borderRadius: 'var(--radius-md)', padding: '0.65rem 1rem', gap: '0.4rem' }}
                      >
                        {isGeneratingArt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                        Generate
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Adventure Settings (host only) */}
              {gameState.hostId === user.uid ? (
                <div className="settings-card">
                  <div className="settings-card-header" onClick={() => setIsAdvSettingsOpen(!isAdvSettingsOpen)}>
                    <div className="settings-card-header-left">
                      <div className="profile-card-header-icon">
                        <Settings className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Adventure Settings</h3>
                        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.75rem' }}>Configure the world (Host only)</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4" style={{ color: 'var(--muted)', transform: isAdvSettingsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 200ms' }} />
                  </div>

                  {isAdvSettingsOpen && (
                    <div className="settings-card-body">
                      <div className="form-grid">
                        <div>
                          <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Theme</p>
                          <select
                            value={currentTheme}
                            onChange={(event) => void updateGameStateInFirestore(roomId, { theme: event.target.value })}
                            className="ritual-input ritual-input--compact"
                          >
                            {THEME_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Custom Setting</p>
                          <textarea
                            defaultValue={gameState.customSetting || ''}
                            onBlur={(event) => void updateGameStateInFirestore(roomId, { customSetting: event.target.value })}
                            className="ritual-input ritual-input--compact ritual-textarea"
                            placeholder="Describe the setting, tone, or weird threat hanging over the room."
                          />
                        </div>

                        <div className="toggle-row">
                          <button
                            type="button"
                            onClick={() => void updateGameStateInFirestore(roomId, { isHardMode: !gameState.isHardMode })}
                            className={cn('ghost-button', gameState.isHardMode && 'ghost-button--active')}
                          >
                            <Sword className="h-4 w-4" />
                            Hard mode
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateGameStateInFirestore(roomId, { isPermadeath: !gameState.isPermadeath })}
                            className={cn('ghost-button', gameState.isPermadeath && 'ghost-button--active')}
                          >
                            <Shield className="h-4 w-4" />
                            Permadeath
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Begin Adventure button (host) */}
              {gameState.hostId === user.uid ? (
                <button
                  type="button"
                  onClick={startGame}
                  disabled={gameState.isGenerating}
                  className="begin-adventure-btn"
                >
                  {gameState.isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Pen className="h-5 w-5" />}
                  Begin Adventure
                </button>
              ) : null}
            </div>

            {/* Right sidebar */}
            <div className="lobby-sidebar">
              {/* The Party */}
              <div className="sidebar-card">
                <div className="sidebar-card-title">
                  <span className="eyebrow" style={{ color: 'var(--accent)' }}>🎭</span>
                  <span className="eyebrow" style={{ color: 'var(--accent)' }}>The Party</span>
                </div>
                <div className="avatar-list">
                  {gameState.players.map((player) => (
                    <div key={player.uid} className="avatar-row">
                      <img
                        src={player.characterArtUrl || player.photoURL || `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${player.uid}`}
                        className="avatar-image"
                        referrerPolicy="no-referrer"
                        alt=""
                      />
                      <div>
                        <div className="avatar-name">{player.displayName}</div>
                        <div className="avatar-meta">{player.isHost ? 'Game Master' : player.hometown || 'Wanderer'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* World Info */}
              <div className="sidebar-card">
                <div className="sidebar-card-title">
                  <span className="eyebrow" style={{ color: 'var(--accent)' }}>🌍</span>
                  <span className="eyebrow" style={{ color: 'var(--accent)' }}>World Info</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <SignalBadge strength={gameState.signalStrength ?? 1} />
                </div>
              </div>

              {/* Abandon Quest */}
              <button type="button" onClick={leaveCurrentGame} className="abandon-link">
                <LogOut className="h-3.5 w-3.5" />
                Abandon Quest
              </button>
            </div>
          </div>
        </>
      ) : (
        /* ── ACTIVE GAME ── */
        <main className="game-layout">
          <section className="story-column">
            <div
              className="story-stage"
              style={{
                backgroundImage: currentNode?.imageUrl ? `url(${currentNode.imageUrl})` : undefined,
              }}
            >
              <div className="story-stage-backdrop" />
              <div className="story-stage-overlay" />
              <div className="story-stage-inner">
                <div className="story-meta">
                  <span className="eyebrow">Chapter {String(chapterNumber).padStart(2, '0')}</span>
                  <SignalBadge strength={gameState.signalStrength ?? 1} />
                </div>

                <div key={currentNode?.id || gameState.currentText} className="story-frame">
                  {currentNode?.choiceMade ? <span className="choice-made">Last move: {currentNode.choiceMade}</span> : null}
                  <StoryViewport text={currentStoryText} className="story-viewport-shell" />
                </div>
              </div>
            </div>

            <OptionDeck
              choices={gameState.currentOptions}
              customActionInput={customActionInput}
              onCustomActionChange={setCustomActionInput}
              onChoice={(choice) => void handleMakeChoice(choice)}
              onSubmitCustomAction={() => void handleMakeChoice(undefined, customActionInput.trim())}
              disabled={gameState.isGenerating}
            />
          </section>

          <aside className="rail-column">
            <section className="panel">
              <p className="eyebrow" style={{ color: 'var(--accent)' }}>Party</p>
              <h3 className="panel-title">Who is in the room</h3>
              <div className="avatar-list" style={{ marginTop: '0.5rem' }}>
                {gameState.players.map((player) => (
                  <div key={player.uid} className="avatar-row">
                    <img
                      src={player.characterArtUrl || player.photoURL || `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${player.uid}`}
                      className="avatar-image"
                      referrerPolicy="no-referrer"
                      alt=""
                    />
                    <div>
                      <div className="avatar-name">{player.displayName}</div>
                      <div className="avatar-meta">{player.isHost ? 'Host' : player.hometown || 'Wanderer'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {gameState.npcs && gameState.npcs.length > 0 ? (
              <section className="panel">
                <p className="eyebrow">Nearby Figures</p>
                <h3 className="panel-title">NPC presence</h3>
                <div className="avatar-list" style={{ marginTop: '0.5rem' }}>
                  {gameState.npcs.map((npc) => (
                    <div key={npc.id} className={cn('avatar-row', !npc.isNearby && 'avatar-row--dim')}>
                      <img
                        src={npc.photoURL || `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${npc.id}`}
                        className="avatar-image avatar-image--small"
                        referrerPolicy="no-referrer"
                        alt=""
                      />
                      <div>
                        <div className="avatar-name">{npc.name}</div>
                        <div className="avatar-meta">{npc.isNearby ? 'Nearby' : 'Distant'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="panel rail-chat">
              <div className="panel-heading-row">
                <div>
                  <p className="eyebrow">Walkie-Talkie</p>
                  <h3 className="panel-title">Party chatter</h3>
                </div>
                <SignalBadge strength={gameState.signalStrength ?? 1} />
              </div>

              <div ref={chatScrollRef} className="chat-log">
                {messages.length === 0 ? (
                  <div className="chat-empty">No voices on the line yet.</div>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className="chat-bubble">
                      <div className="chat-bubble-meta">{message.senderName}</div>
                      <div className="chat-bubble-copy">{garbleText(message.text, gameState.signalStrength)}</div>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleSendMessage} className="chat-form">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  className="ritual-input ritual-input--compact"
                  placeholder="Send a party message or address an NPC with @name"
                />
                <button type="submit" className="ghost-button">
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </form>
            </section>
          </aside>
        </main>
      )}

      {/* ── Settings modal ── */}
      <AnimatePresence>
        {isSettingsOpen ? (
          <div className="overlay-shell">
            <div className="overlay-backdrop" onClick={() => setIsSettingsOpen(false)} />
            <motion.div className="modal-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="panel-heading-row">
                <div>
                  <p className="eyebrow">Settings</p>
                  <h3 className="panel-title">Narration and access</h3>
                </div>
                <button type="button" className="icon-button" onClick={() => setIsSettingsOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
                <select 
                  value={aiProvider}
                  onChange={(e) => {
                    setAiProvider(e.target.value);
                    setAiModel(MODELS_BY_PROVIDER[e.target.value as keyof typeof MODELS_BY_PROVIDER][0].id);
                  }}
                  className="ritual-input ritual-input--compact"
                >
                  {AI_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>

                <select 
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="ritual-input ritual-input--compact"
                >
                  {MODELS_BY_PROVIDER[aiProvider as keyof typeof MODELS_BY_PROVIDER].map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>

                {aiProvider === 'gemini' && (
                  <input
                    type="password"
                    value={userApiKey}
                    onChange={(event) => setUserApiKey(event.target.value)}
                    className="ritual-input ritual-input--compact"
                    placeholder="Gemini API key"
                  />
                )}
                {aiProvider === 'groq' && (
                  <input
                    type="password"
                    value={groqApiKey}
                    onChange={(event) => setGroqApiKey(event.target.value)}
                    className="ritual-input ritual-input--compact"
                    placeholder="Groq API key"
                  />
                )}
                {aiProvider === 'openrouter' && (
                  <input
                    type="password"
                    value={openRouterApiKey}
                    onChange={(event) => setOpenRouterApiKey(event.target.value)}
                    className="ritual-input ritual-input--compact"
                    placeholder="OpenRouter API key"
                  />
                )}
                
                <div className="form-grid">
                  <button type="button" onClick={handleSaveUserApiKey} className="primary-button" disabled={isSavingApiKey}>
                    {isSavingApiKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    Save Settings
                  </button>
                  <button type="button" onClick={leaveCurrentGame} className="ghost-button">
                    <LogOut className="h-4 w-4" />
                    Leave current room
                  </button>
                </div>
              </div>

              {/* UI Theme picker */}
              <div style={{ marginTop: '1rem' }}>
                <p className="theme-picker-label">UI Theme</p>
                <div className="theme-swatch-grid">
                  {UI_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      title={t.label}
                      className={`theme-swatch ${uiTheme === t.id ? 'theme-swatch--active' : ''}`}
                      style={{ background: t.color }}
                      onClick={() => setUiTheme(t.id)}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* ── History modal ── */}
      <AnimatePresence>
        {isHistoryOpen ? (
          <div className="overlay-shell">
            <div className="overlay-backdrop" onClick={() => setIsHistoryOpen(false)} />
            <motion.div className="modal-panel modal-panel--wide" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="panel-heading-row">
                <div>
                  <p className="eyebrow">Adventure History</p>
                  <h3 className="panel-title">Previous scenes</h3>
                </div>
                <button type="button" className="icon-button" onClick={() => setIsHistoryOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="history-list">
                {gameState.history.length === 0 ? (
                  <div className="chat-empty">The archive is still empty.</div>
                ) : (
                  gameState.history.map((node, index) => (
                    <article key={node.id} className="history-entry">
                      <div className="history-entry-meta">
                        <span className="eyebrow">Chapter {String(index + 1).padStart(2, '0')}</span>
                        {node.choiceMade ? <span className="choice-made">Choice: {node.choiceMade}</span> : null}
                      </div>
                      <p className="history-entry-copy">{node.text}</p>
                    </article>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* ── Error toast ── */}
      <AnimatePresence>
        {error ? (
          <motion.div className="toast toast--error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
