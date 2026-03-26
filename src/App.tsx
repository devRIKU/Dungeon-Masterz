import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle } from './firebase';
import { GameState, Player, StoryNode, StoryChoice, ChatMessage } from './types';
import { generateStoryPart, generateAudio, generateImage, setApiKey } from './services/geminiService';
import { 
  createGameInFirestore, 
  joinGameInFirestore, 
  updateGameStateInFirestore, 
  subscribeToGame, 
  sendChatMessage, 
  subscribeToChat, 
  addHistoryNode, 
  subscribeToHistory,
  getUserSettings,
  updateUserSettings
} from './services/gameService';
import { cn } from './lib/utils';
import { soundManager } from './lib/sounds';
import { 
  Sword, 
  Users, 
  User as UserIcon, 
  LogOut, 
  Copy, 
  Check, 
  ChevronRight, 
  Loader2, 
  ScrollText,
  Shield,
  Map as MapIcon,
  Volume2,
  VolumeX,
  MessageSquare,
  Send,
  SignalHigh,
  SignalMedium,
  SignalLow,
  SignalZero,
  Info,
  X,
  Settings,
  History,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const garbleText = (text: string, strength: number) => {
  if (strength >= 1) return text;
  return text.split('').map(char => {
    if (char === ' ') return ' ';
    return Math.random() > strength ? (Math.random() > 0.5 ? '...' : '█') : char;
  }).join('');
};

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isOptionsCollapsed, setIsOptionsCollapsed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [customActionInput, setCustomActionInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isGeneratingArt, setIsGeneratingArt] = useState(false);
  const [roomId, setRoomId] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isPartyOpen, setIsPartyOpen] = useState(false);
  const [isAdventureSettingsOpen, setIsAdventureSettingsOpen] = useState(false);
  const [userApiKey, setUserApiKey] = useState('');
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const isAIStudio = () => {
    return window.location.hostname.includes('ais-dev') || 
           window.location.hostname.includes('ais-pre') ||
           !!(window as any).aistudio;
  };

  const speakText = (text: string) => {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    // Find a decent voice if possible
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google') || v.name.includes('Natural')) || voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.rate = 0.9; // Slightly slower for atmosphere
    utterance.pitch = 0.8; // Lower pitch for mystery
    
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
    if (!hasSeenTutorial) {
      setShowTutorial(true);
    }
  }, []);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const settings = await getUserSettings(u.uid);
        if (settings?.geminiApiKey) {
          setUserApiKey(settings.geminiApiKey);
          setApiKey(settings.geminiApiKey);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!roomId) return;
    
    const unsubscribeGame = subscribeToGame(roomId, (state) => {
      setGameState(prev => {
        if (!prev) return { ...state, history: [] };
        return { ...state, history: prev.history };
      });
    });

    const unsubscribeHistory = subscribeToHistory(roomId, (history) => {
      setGameState(prev => {
        if (!prev) return null;
        return { ...prev, history };
      });
    });

    const unsubscribeChat = subscribeToChat(roomId, (msgs) => {
      setMessages(prev => {
        if (msgs.length > prev.length) {
          soundManager.playMessage();
        }
        return msgs;
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
  }, [messages, isChatOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [gameState?.history, gameState?.currentText]);

  const [isCreatingGame, setIsCreatingGame] = useState(false);

  const createGame = async () => {
    if (!user) return;
    setIsCreatingGame(true);
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const player: Player = {
      uid: user.uid,
      displayName: user.displayName || 'Adventurer',
      photoURL: user.photoURL || undefined,
      isHost: true
    };
    
    try {
      await createGameInFirestore(newRoomId, player);
      setRoomId(newRoomId);
      soundManager.playSuccess();
    } catch (err) {
      console.error(err);
      setError("Failed to create game.");
      soundManager.playError();
    } finally {
      setIsCreatingGame(false);
    }
  };

  const joinGame = async (id: string) => {
    if (!user || !id) return;
    const player: Player = {
      uid: user.uid,
      displayName: user.displayName || 'Adventurer',
      photoURL: user.photoURL || undefined,
      isHost: false
    };
    
    try {
      const success = await joinGameInFirestore(id, player);
      if (success) {
        setRoomId(id);
        soundManager.playSuccess();
      } else {
        setError("Game not found.");
        soundManager.playError();
      }
    } catch (err) {
      console.error(err);
      setError("Failed to join game.");
      soundManager.playError();
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    soundManager.playClick();
    setTimeout(() => setCopied(false), 2000);
  };

  const startGame = async () => {
    if (!gameState || gameState.hostId !== user?.uid) return;
    
    await updateGameStateInFirestore(roomId, { isGenerating: true });
    try {
      const theme = gameState.theme || '80s';
      const result = await generateStoryPart(
        [], 
        gameState.players, 
        undefined, 
        undefined, 
        theme,
        gameState.customSetting,
        gameState.isHardMode,
        gameState.isPermadeath
      );
      
      // Generate initial scene image
      const scenePrompt = `A high-quality cinematic illustration of the following scene in a ${theme} style: ${result.text.substring(0, 300)}`;
      const imageUrl = await generateImage(scenePrompt, "16:9");

      const newNode: StoryNode = {
        id: 'start',
        text: result.text,
        choices: result.choices,
        timestamp: Date.now(),
        authorId: 'ai',
        imageUrl: imageUrl || undefined
      };

      await addHistoryNode(roomId, newNode);

      const newState = {
        status: 'active' as const,
        currentText: result.text,
        currentOptions: result.choices,
        signalStrength: result.signalStrength ?? 1.0,
        isGenerating: false,
        npcs: result.npcs || []
      };
      await updateGameStateInFirestore(roomId, newState);
      soundManager.playSuccess();
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("GEMINI_API_KEY") || errMsg.toLowerCase().includes("api key") || errMsg.includes("403") || errMsg.includes("400")) {
        setError("GEMINI_API_KEY is missing or invalid. Please check your configuration.");
      } else {
        setError("Failed to start the adventure. Please try again.");
      }
      await updateGameStateInFirestore(roomId, { isGenerating: false });
    }
  };

  const handleMakeChoice = async (choice?: StoryChoice, customAction?: string) => {
    if (!gameState || gameState.isGenerating) return;

    // Broadcast that we're generating
    await updateGameStateInFirestore(roomId, { isGenerating: true });

    try {
      const theme = gameState.theme || '80s';
      const result = await generateStoryPart(
        gameState.history, 
        gameState.players, 
        choice?.text, 
        customAction,
        theme,
        gameState.customSetting,
        gameState.isHardMode,
        gameState.isPermadeath
      );
      
      // Generate scene image
      const scenePrompt = `A high-quality cinematic illustration of the following scene in a ${theme} style: ${result.text.substring(0, 300)}`;
      const imageUrl = await generateImage(scenePrompt, "16:9");

      const newNode: StoryNode = {
        id: Math.random().toString(36).substring(7),
        text: result.text,
        choices: result.choices,
        timestamp: Date.now(),
        authorId: 'ai',
        choiceMade: customAction || choice?.text,
        imageUrl: imageUrl || undefined
      };

      await addHistoryNode(roomId, newNode);

      const newState = {
        currentText: result.text,
        currentOptions: result.choices,
        signalStrength: result.signalStrength ?? 1.0,
        isGenerating: false,
        npcs: result.npcs || gameState.npcs || []
      };
      await updateGameStateInFirestore(roomId, newState);
      setCustomActionInput('');
      soundManager.playSuccess();
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("GEMINI_API_KEY") || errMsg.toLowerCase().includes("api key") || errMsg.includes("403") || errMsg.includes("400")) {
        setError("GEMINI_API_KEY is missing or invalid. Please check your configuration.");
      } else {
        setError("The DM is momentarily speechless. Try again.");
      }
      await updateGameStateInFirestore(roomId, { isGenerating: false });
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !user || !roomId) return;

    const text = chatInput.trim();
    const message = {
      senderId: user.uid,
      senderName: user.displayName || 'Adventurer',
      text,
      timestamp: Date.now(),
    };

    setChatInput('');
    await sendChatMessage(roomId, message);

    // Check if addressing an NPC
    const addressedNPC = gameState?.npcs?.find(npc => 
      text.toLowerCase().includes(`@${npc.name.toLowerCase()}`) && npc.isNearby
    );

    if (addressedNPC) {
      // Trigger a story update where the NPC responds
      handleMakeChoice(undefined, `I say to ${addressedNPC.name}: "${text}"`);
    }
  };

  const saveQuiz = async (hometown: string, fear: string, characterName?: string, characterArtUrl?: string) => {
    if (!gameState || !user) return;
    const updatedPlayers = gameState.players.map(p => 
      p.uid === user.uid ? { 
        ...p, 
        hometown, 
        fear, 
        displayName: characterName || p.displayName,
        characterArtUrl: characterArtUrl || p.characterArtUrl
      } : p
    );
    await updateGameStateInFirestore(roomId, { players: updatedPlayers });
  };

  const playStoryAudio = async () => {
    if (!gameState?.currentText || isAudioLoading) return;
    
    // If on AI Studio, use the high-quality (but slower) Gemini TTS + Web Audio effects
    if (isAIStudio()) {
      setIsAudioLoading(true);
      try {
        const base64Data = await generateAudio(gameState.currentText);
        if (base64Data) {
          await soundManager.playVoice(base64Data);
        }
      } catch (err) {
        console.error("Audio generation failed:", err);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("GEMINI_API_KEY") || errMsg.toLowerCase().includes("api key") || errMsg.includes("403") || errMsg.includes("400")) {
          setError("GEMINI_API_KEY is missing or invalid. Please check your configuration.");
        } else {
          // Fallback to local speech if Gemini fails
          speakText(gameState.currentText);
        }
      } finally {
        setIsAudioLoading(false);
      }
      return;
    }

    // Otherwise (using own API key), use the fast local SpeechSynthesis
    speakText(gameState.currentText);
  };

  const generateCharacterArt = async () => {
    if (!gameState || !user) return;
    const player = gameState.players.find(p => p.uid === user.uid);
    if (!player) return;

    setIsGeneratingArt(true);
    try {
      const theme = gameState.theme || '80s';
      const prompt = `A cinematic character portrait of a person named ${player.displayName} from ${player.hometown || 'a small town'}, whose greatest fear is ${player.fear || 'the unknown'}. Style: ${theme} adventure. High quality, detailed.`;
      const artUrl = await generateImage(prompt, "1:1");
      if (artUrl) {
        await saveQuiz(player.hometown || '', player.fear || '', player.displayName, artUrl);
      }
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("GEMINI_API_KEY") || errMsg.toLowerCase().includes("api key") || errMsg.includes("403") || errMsg.includes("400")) {
        setError("GEMINI_API_KEY is missing or invalid. Please check your configuration.");
      }
    } finally {
      setIsGeneratingArt(false);
    }
  };

  const [isApiKeyMissing, setIsApiKeyMissing] = useState(false);

  useEffect(() => {
    // Check if API key is available
    const checkApiKey = async () => {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const data = await response.json();
          if (!data.geminiApiKey) {
            setIsApiKeyMissing(true);
          }
        } else {
          setIsApiKeyMissing(true);
        }
      } catch (e) {
        setIsApiKeyMissing(true);
      }
    };
    checkApiKey();
  }, []);

  const showApiKeyError = isApiKeyMissing || (error && error.includes("GEMINI_API_KEY"));

  if (showApiKeyError) {
    return (
      <div className="min-h-screen bg-bg text-ink flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden transition-colors duration-500">
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-accent/20 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-blue-900/20 blur-[120px] rounded-full" />
        </div>
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-lg bg-bg border border-red-500/30 rounded-3xl p-8 space-y-6 shadow-2xl relative overflow-hidden z-10"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-red-500" />
          <div className="flex items-center gap-4 text-red-500 mb-2">
            <Shield className="w-8 h-8" />
            <h2 className="text-2xl font-display font-bold">API Key Required</h2>
          </div>
          
          <div className="space-y-4 text-ink/80 leading-relaxed">
            <p>
              Your adventure cannot begin because the <strong>Gemini API Key</strong> is missing or invalid.
            </p>
            <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/20 text-sm">
              <h4 className="font-bold text-red-500 mb-2 uppercase tracking-wider text-xs">How to fix this:</h4>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>On Netlify:</strong> Go to Site configuration &gt; Environment variables. Add <code>GEMINI_API_KEY</code> and trigger a new deploy.</li>
                <li><strong>In AI Studio:</strong> Add the key to your Secrets menu.</li>
                <li><strong>Local Development:</strong> Add it to your <code>.env</code> file.</li>
              </ul>
            </div>
            <p className="text-xs opacity-60 italic mt-4">
              This screen will disappear once a valid key is provided and the app is reloaded.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-bg text-ink flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden transition-colors duration-500">
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-accent/20 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-blue-900/20 blur-[120px] rounded-full" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="z-10 text-center max-w-lg w-full"
        >
          <div className="mb-10 flex justify-center">
            <motion.div 
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
              className="p-6 glass rounded-3xl shadow-2xl shadow-accent/10"
            >
              <Sparkles className="w-20 h-20 text-accent" />
            </motion.div>
          </div>
          
          <h1 className="text-7xl font-display font-bold mb-6 tracking-tight bg-gradient-to-b from-ink to-ink/40 bg-clip-text text-transparent uppercase animate-glitch cursor-default">
            Runescribe
          </h1>
          
          <p className="text-ink/60 mb-12 text-xl leading-relaxed font-light tracking-wide px-4">
            "Step into the realm of infinite stories, where every choice weaves a new destiny."
          </p>
          
          <div className="space-y-4 px-4">
            <button
              onClick={() => {
                signInWithGoogle();
                soundManager.playClick();
              }}
              onMouseEnter={() => soundManager.playHover()}
              className="w-full py-5 px-8 bg-ink text-bg font-display font-bold text-lg rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 group shadow-2xl shadow-ink/10"
            >
              <Shield className="w-6 h-6 group-hover:rotate-12 transition-transform" />
              Begin Your Journey
            </button>
            
            <div className="flex items-center justify-center gap-6 pt-8 opacity-40">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em]">
                <Users className="w-4 h-4" /> Multiplayer
              </div>
              <div className="w-1 h-1 bg-ink rounded-full" />
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em]">
                <Sparkles className="w-4 h-4" /> AI Powered
              </div>
            </div>
          </div>
        </motion.div>

        {/* Theme Toggle on Login Screen */}
        <button 
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          className="fixed bottom-8 right-8 p-4 glass rounded-full hover:scale-110 transition-all z-50"
        >
          {theme === 'dark' ? <Sparkles className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
        </button>
      </div>
    );
  }

  const handleSaveUserApiKey = async () => {
    if (!user) return;
    setIsSavingApiKey(true);
    try {
      await updateUserSettings(user.uid, { geminiApiKey: userApiKey });
      setApiKey(userApiKey);
      soundManager.playClick();
    } catch (err) {
      console.error("Failed to save API key", err);
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const renderModals = () => (
    <>
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-bg border border-border rounded-3xl p-8 space-y-8 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-display font-bold flex items-center gap-3">
                  <Settings className="w-5 h-5 text-accent" /> Adventure Settings
                </h3>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-ink/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                {!gameState ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                    <Settings className="w-12 h-12" />
                    <p className="text-lg font-display font-bold">No active adventure.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Adventure Theme</label>
                      <div className="relative">
                        <select
                          value={gameState?.theme || '80s'}
                          onChange={(e) => updateGameStateInFirestore(roomId, { theme: e.target.value })}
                          className="w-full appearance-none bg-bg border border-border rounded-2xl px-4 py-3 pr-10 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all font-medium text-ink"
                        >
                          {[
                            '80s', 'Fantasy', 'Cyberpunk', 'Horror', 'Sci-Fi', 
                            'Post-Apocalyptic', 'Steampunk', 'Western', 'Noir', 
                            'Mystery', 'Superhero', 'Historical', 'Space Opera', 
                            'Lovecraftian', 'High Fantasy', 'Dark Fantasy', 
                            'Urban Fantasy', 'Grimdark', 'Cozy', 'Comedy'
                          ].map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-ink/40">
                          <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
                            <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path>
                          </svg>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Custom Setting</label>
                      <textarea
                        defaultValue={gameState?.customSetting || ''}
                        onBlur={(e) => updateGameStateInFirestore(roomId, { customSetting: e.target.value })}
                        placeholder="e.g. Set in a floating city..."
                        className="w-full bg-ink/5 border border-border rounded-2xl p-4 text-sm focus:outline-none focus:border-accent/50 transition-all h-24 resize-none font-medium"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => updateGameStateInFirestore(roomId, { isHardMode: !gameState?.isHardMode })}
                        className={cn(
                          "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all font-display font-bold text-[10px] uppercase tracking-widest",
                          gameState?.isHardMode ? "bg-accent/10 border-accent text-accent" : "bg-ink/5 border-border text-ink/40"
                        )}
                      >
                        <Sword className="w-5 h-5" />
                        Hard Mode
                      </button>
                      <button
                        onClick={() => updateGameStateInFirestore(roomId, { isPermadeath: !gameState?.isPermadeath })}
                        className={cn(
                          "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all font-display font-bold text-[10px] uppercase tracking-widest",
                          gameState?.isPermadeath ? "bg-accent/10 border-accent text-accent" : "bg-ink/5 border-border text-ink/40"
                        )}
                      >
                        <Shield className="w-5 h-5" />
                        Permadeath
                      </button>
                    </div>

                    <div className="pt-4 border-t border-border space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Personal Gemini API Key</label>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={userApiKey}
                            onChange={(e) => setUserApiKey(e.target.value)}
                            placeholder="Paste your API key here..."
                            className="flex-1 bg-ink/5 border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all font-mono"
                          />
                          <button
                            onClick={handleSaveUserApiKey}
                            disabled={isSavingApiKey}
                            className="px-4 bg-accent text-white rounded-2xl font-display font-bold text-[10px] uppercase tracking-widest hover:scale-[1.05] active:scale-[0.95] transition-all disabled:opacity-50"
                          >
                            {isSavingApiKey ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                          </button>
                        </div>
                        <p className="text-[10px] text-ink/40 italic ml-1">
                          Optional: Use your own key for higher limits. Stored securely in your account.
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-full py-4 bg-ink text-bg rounded-2xl font-display font-bold hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl"
              >
                Save Changes
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isHistoryOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="w-full max-w-4xl h-[80vh] bg-bg border border-border rounded-3xl flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-ink/5">
                <h3 className="text-xl font-display font-bold flex items-center gap-3">
                  <History className="w-5 h-5 text-accent" /> Adventure History
                </h3>
                <button onClick={() => setIsHistoryOpen(false)} className="p-2 hover:bg-ink/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-16">
                {!gameState ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                    <History className="w-12 h-12" />
                    <p className="text-lg font-display font-bold">No history available.</p>
                  </div>
                ) : gameState.history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                    <ScrollText className="w-12 h-12" />
                    <p className="text-lg font-display font-bold">The scroll is empty...</p>
                  </div>
                ) : (
                  gameState.history.map((node, idx) => (
                    <div key={node.id} className="space-y-8">
                      <div className="flex items-center gap-6 text-[10px] font-display font-bold text-ink/20 uppercase tracking-[0.3em]">
                        <span className="w-12 h-px bg-border" />
                        Chapter {idx + 1}
                        <span className="flex-1 h-px bg-border" />
                      </div>
                      
                      <div className="grid lg:grid-cols-2 gap-12 items-start">
                        <div className="space-y-6">
                          <p className="text-xl leading-relaxed text-ink/80 font-medium italic tracking-tight">
                            {node.text}
                          </p>
                          {node.choiceMade && (
                            <div className="flex items-center gap-3 text-accent font-display font-bold text-xs uppercase tracking-widest">
                              <ChevronRight className="w-4 h-4" />
                              Action: {node.choiceMade}
                            </div>
                          )}
                        </div>
                        {node.imageUrl && (
                          <div className="aspect-video rounded-2xl overflow-hidden border border-border shadow-lg">
                            <img src={node.imageUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {error && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 bg-red-500 text-white font-medium rounded-full shadow-lg flex items-center gap-3">
            <Shield className="w-4 h-4" />
            {error}
            <button onClick={() => setError(null)} className="ml-2 hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </AnimatePresence>
    </>
  );

  if (!gameState) {
    return (
      <div className="min-h-screen bg-bg text-ink p-6 font-sans flex flex-col items-center justify-center transition-colors duration-500">
        <div className="max-w-md w-full space-y-10">
          <div className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-4">
              <div className="relative">
                <img src={user.photoURL || ''} alt="" className="w-12 h-12 rounded-2xl border border-border shadow-lg" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-bg" />
              </div>
              <div>
                <p className="text-[10px] text-ink/40 uppercase tracking-[0.2em] font-bold font-display">Adventurer</p>
                <p className="font-display font-bold text-lg">{user.displayName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                className="p-2.5 glass rounded-xl hover:scale-110 transition-all text-ink/60"
              >
                {theme === 'dark' ? <Sparkles className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
              </button>
              <button 
                onClick={() => {
                  setIsHistoryOpen(true);
                  soundManager.playClick();
                }}
                className="p-2.5 glass rounded-xl hover:scale-110 transition-all text-ink/60"
              >
                <History className="w-5 h-5" />
              </button>
              <button 
                onClick={() => {
                  auth.signOut();
                  soundManager.playClick();
                }}
                className="p-2.5 glass rounded-xl hover:scale-110 transition-all text-ink/60"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="grid gap-6">
            <button
              onClick={() => {
                createGame();
                soundManager.playClick();
              }}
              disabled={isCreatingGame}
              className="group relative p-8 glass rounded-3xl hover:border-accent/50 transition-all text-left overflow-hidden shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-20 transition-opacity">
                {isCreatingGame ? <Loader2 className="w-24 h-24 animate-spin" /> : <Sparkles className="w-24 h-24" />}
              </div>
              <h3 className="text-2xl font-display font-bold mb-2">
                {isCreatingGame ? "Forging Destiny..." : "New Adventure"}
              </h3>
              <p className="text-sm text-ink/50 leading-relaxed">Embark on a personal quest through the unknown. Forge your own destiny.</p>
            </button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-[0.3em]">
                <span className="bg-bg px-4 text-ink/30 font-bold">Or Join Party</span>
              </div>
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                placeholder="ROOM CODE"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="flex-1 glass rounded-2xl px-6 py-4 focus:outline-none focus:border-accent/50 transition-colors uppercase tracking-[0.3em] font-display font-bold text-center"
              />
              <button
                onClick={() => {
                  joinGame(roomId);
                  soundManager.playClick();
                }}
                className="px-8 bg-ink text-bg font-display font-bold rounded-2xl hover:scale-[1.05] transition-all shadow-lg"
              >
                Join
              </button>
            </div>
          </div>
        </div>
        {renderModals()}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-ink font-sans flex flex-col h-screen overflow-hidden transition-colors duration-300">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between bg-bg/80 backdrop-blur-md z-20">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center border border-accent/20">
              <ScrollText className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-xl font-display font-bold tracking-tight hidden sm:block">Runescribe</h1>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-1.5 bg-ink/5 rounded-full border border-border">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-display font-bold tracking-[0.2em] uppercase opacity-60">{roomId}</span>
            <button onClick={copyRoomCode} className="ml-1 hover:text-accent transition-colors">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-3">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 sm:p-2.5 hover:bg-ink/5 rounded-xl border border-border transition-all"
            title="Toggle Theme"
          >
            {theme === 'dark' ? <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" /> : <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />}
          </button>
          
          <button 
            onClick={() => setIsPartyOpen(true)}
            className="lg:hidden p-2 sm:p-2.5 hover:bg-ink/5 rounded-xl border border-border transition-all"
          >
            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          
          <button 
            onClick={() => setIsChatOpen(true)}
            className="lg:hidden p-2 sm:p-2.5 hover:bg-ink/5 rounded-xl border border-border transition-all"
          >
            <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <button
            onClick={() => {
              setGameState(null);
              soundManager.playClick();
            }}
            className="p-2 sm:p-2.5 hover:bg-red-500/10 hover:text-red-500 rounded-xl border border-border transition-all"
            title="Leave Game"
          >
            <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Mobile Drawers */}
        <AnimatePresence>
          {(isChatOpen || isPartyOpen) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsChatOpen(false); setIsPartyOpen(false); }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden"
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isChatOpen && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-[320px] bg-[#0a0a0a] border-l border-gray-900 z-50 lg:hidden flex flex-col p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
                  <MessageSquare className="w-3 h-3" /> Walkie-Talkie
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    onClick={playStoryAudio}
                    disabled={isAudioLoading || gameState.isGenerating}
                    className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors text-gray-500 hover:text-red-500 disabled:opacity-50"
                  >
                    {isAudioLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                  </button>
                  <button onClick={() => setIsChatOpen(false)} className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-black/40 border border-gray-800 rounded-xl flex flex-col min-h-0">
                <div 
                  ref={chatScrollRef}
                  className="flex-1 overflow-y-auto p-3 space-y-3 scroll-smooth"
                >
                  {messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center p-4">
                      <p className="text-[10px] text-gray-600 uppercase tracking-widest">No transmissions...</p>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-gray-500 uppercase">{msg.senderName}</span>
                        </div>
                        <p className="text-xs text-gray-300 break-words font-mono">
                          {garbleText(msg.text, gameState.signalStrength)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={handleSendMessage} className="p-2 border-t border-gray-800 flex gap-2">
                  <input 
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Over..."
                    className="flex-1 bg-transparent text-xs focus:outline-none px-2"
                  />
                  <button type="submit" className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors text-gray-500 hover:text-white">
                    <Send className="w-3 h-3" />
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isPartyOpen && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-[320px] bg-[#0a0a0a] border-l border-gray-900 z-50 lg:hidden flex flex-col p-6 overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
                  <Users className="w-3 h-3" /> The Party
                </h4>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => updateGameStateInFirestore(roomId, { isCompactOptions: !gameState.isCompactOptions })}
                    className="text-[10px] uppercase tracking-widest text-gray-600 hover:text-white transition-colors"
                  >
                    {gameState.isCompactOptions ? "Expand" : "Compact"}
                  </button>
                  <button onClick={() => setIsPartyOpen(false)} className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-6">
                <div className="space-y-4">
                  {gameState.players.map((p) => (
                    <div key={p.uid} className="flex items-center gap-3">
                      <div className="relative">
                        <img 
                          src={p.characterArtUrl || p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.uid}`} 
                          className="w-10 h-10 rounded-full border border-gray-800 bg-gray-900 object-cover" 
                        />
                        {p.isHost && (
                          <div className="absolute -top-1 -right-1 bg-yellow-500 rounded-full p-0.5">
                            <Shield className="w-2 h-2 text-black" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold">{p.displayName}</span>
                        <span className="text-[10px] text-gray-600 uppercase tracking-widest">
                          {p.hometown || 'Unknown Origin'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {gameState.npcs && gameState.npcs.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
                      <UserIcon className="w-3 h-3" /> NPCs
                    </h4>
                    <div className="space-y-3">
                      {gameState.npcs.map((npc) => (
                        <div key={npc.id} className={cn("flex items-center gap-3 transition-opacity", !npc.isNearby && "opacity-40")}>
                          <div className="relative">
                            <img 
                              src={npc.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${npc.id}`} 
                              className="w-8 h-8 rounded-full border border-gray-800 bg-gray-900 object-cover" 
                            />
                            {npc.isNearby && (
                              <div className="absolute -top-1 -right-1 bg-green-500 rounded-full w-2 h-2 border border-black" />
                            )}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{npc.name}</span>
                            <span className="text-[10px] text-gray-600 uppercase tracking-tighter">
                              {npc.isNearby ? "Nearby" : "Away"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="mt-auto pt-8">
                <div className="p-4 bg-[#111] rounded-xl border border-gray-800 text-sm text-gray-400 italic flex items-center gap-3 mb-6">
                  {gameState.signalStrength > 0.8 ? <SignalHigh className="w-4 h-4 text-green-500" /> :
                   gameState.signalStrength > 0.4 ? <SignalMedium className="w-4 h-4 text-yellow-500" /> :
                   gameState.signalStrength > 0.1 ? <SignalLow className="w-4 h-4 text-orange-500 animate-pulse" /> :
                   <SignalZero className="w-4 h-4 text-red-500 animate-pulse" />}
                  <span>Signal: {gameState.signalStrength > 0.8 ? "Clear" : gameState.signalStrength > 0.4 ? "Weak" : "Jammed"}</span>
                </div>
                <button
                  onClick={() => {
                    setGameState(null);
                    soundManager.playClick();
                  }}
                  onMouseEnter={() => soundManager.playHover()}
                  className="w-full py-3 border border-gray-800 rounded-xl text-sm font-bold hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" /> Abandon Quest
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-6 md:p-12 space-y-12 scroll-smooth"
          >
            {gameState.status === 'lobby' ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-8 py-12">
                <div className="relative">
                  <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full" />
                  <ScrollText className="w-20 h-20 text-accent relative z-10" />
                </div>
                
                <div className="space-y-3">
                  <h2 className="text-4xl font-display font-bold tracking-tight">The Gathering</h2>
                  <p className="text-ink/60 max-w-sm mx-auto font-medium">
                    Prepare your spirit. The Dungeon Master awaits the arrival of all companions.
                  </p>
                </div>

                <div className="w-full max-w-2xl space-y-6 text-left">
                  {/* Character Profile Section */}
                  <div className="glass rounded-3xl border border-border overflow-hidden shadow-2xl">
                    <div className="p-6 md:p-8 bg-ink/5 border-b border-border flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center text-accent">
                        <Shield className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-display font-bold">Character Profile</h3>
                        <p className="text-xs text-ink/50 font-medium">Define your hero's identity</p>
                      </div>
                    </div>
                    <div className="p-6 md:p-8 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Character Name</label>
                          <input 
                            type="text" 
                            placeholder="Your Name"
                            defaultValue={gameState.players.find(p => p.uid === user.uid)?.displayName || ''}
                            onBlur={(e) => saveQuiz(
                              gameState.players.find(p => p.uid === user.uid)?.hometown || '', 
                              gameState.players.find(p => p.uid === user.uid)?.fear || '',
                              e.target.value
                            )}
                            className="w-full bg-bg border border-border rounded-2xl px-4 py-3 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all font-medium"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Origin / Hometown</label>
                          <input 
                            type="text" 
                            placeholder="Where are you from?"
                            defaultValue={gameState.players.find(p => p.uid === user.uid)?.hometown || ''}
                            onBlur={(e) => saveQuiz(
                              e.target.value, 
                              gameState.players.find(p => p.uid === user.uid)?.fear || '',
                              gameState.players.find(p => p.uid === user.uid)?.displayName
                            )}
                            className="w-full bg-bg border border-border rounded-2xl px-4 py-3 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all font-medium"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Greatest Fear</label>
                        <input 
                          type="text" 
                          placeholder="What haunts your dreams?"
                          defaultValue={gameState.players.find(p => p.uid === user.uid)?.fear || ''}
                          onBlur={(e) => saveQuiz(
                            gameState.players.find(p => p.uid === user.uid)?.hometown || '', 
                            e.target.value,
                            gameState.players.find(p => p.uid === user.uid)?.displayName,
                            gameState.players.find(p => p.uid === user.uid)?.characterArtUrl
                          )}
                          className="w-full bg-bg border border-border rounded-2xl px-4 py-3 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all font-medium"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Character Portrait (URL)</label>
                        <div className="flex gap-3">
                          <input 
                            type="text" 
                            placeholder="https://..."
                            defaultValue={gameState.players.find(p => p.uid === user.uid)?.characterArtUrl || ''}
                            onBlur={(e) => saveQuiz(
                              gameState.players.find(p => p.uid === user.uid)?.hometown || '', 
                              gameState.players.find(p => p.uid === user.uid)?.fear || '',
                              gameState.players.find(p => p.uid === user.uid)?.displayName,
                              e.target.value
                            )}
                            className="flex-1 bg-bg border border-border rounded-2xl px-4 py-3 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all font-medium"
                          />
                          <button
                            onClick={() => {
                              generateCharacterArt();
                              soundManager.playClick();
                            }}
                            disabled={isGeneratingArt}
                            className="px-6 bg-accent text-white font-display font-bold rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-accent/20"
                          >
                            {isGeneratingArt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            <span className="hidden sm:inline">Generate</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Adventure Settings Section */}
                  {gameState.hostId === user.uid && (
                    <div className="glass rounded-3xl border border-border overflow-hidden shadow-2xl">
                      <button 
                        onClick={() => setIsAdventureSettingsOpen(!isAdventureSettingsOpen)}
                        className="w-full p-6 md:p-8 bg-ink/5 flex items-center justify-between group transition-colors hover:bg-ink/10"
                      >
                        <div className="flex items-center gap-4 text-left">
                          <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center text-accent group-hover:scale-110 transition-transform">
                            <Settings className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="text-xl font-display font-bold">Adventure Settings</h3>
                            <p className="text-xs text-ink/50 font-medium">Configure the world (Host only)</p>
                          </div>
                        </div>
                        <ChevronRight className={cn("w-6 h-6 text-ink/40 transition-transform duration-300", isAdventureSettingsOpen ? "rotate-90" : "")} />
                      </button>
                      
                      <AnimatePresence>
                        {isAdventureSettingsOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="border-t border-border overflow-hidden"
                          >
                            <div className="p-6 md:p-8 space-y-8 bg-bg/50">
                              <div className="space-y-3">
                                <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Genre & Atmosphere</label>
                                <div className="relative">
                                  <select
                                    value={gameState?.theme || '80s'}
                                    onChange={(e) => {
                                      updateGameStateInFirestore(roomId, { theme: e.target.value });
                                      soundManager.playClick();
                                    }}
                                    className="w-full appearance-none bg-bg border border-border rounded-2xl px-4 py-3 pr-10 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all font-medium text-ink"
                                  >
                                    {[
                                      '80s', 'Fantasy', 'Cyberpunk', 'Horror', 'Sci-Fi', 
                                      'Post-Apocalyptic', 'Steampunk', 'Western', 'Noir', 
                                      'Mystery', 'Superhero', 'Historical', 'Space Opera', 
                                      'Lovecraftian', 'High Fantasy', 'Dark Fantasy', 
                                      'Urban Fantasy', 'Grimdark', 'Cozy', 'Comedy'
                                    ].map((t) => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                  <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-ink/40">
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
                                      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path>
                                    </svg>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="text-[10px] font-display font-bold uppercase tracking-[0.2em] text-ink/40 ml-1">Custom Setting</label>
                                <textarea
                                  defaultValue={gameState?.customSetting || ''}
                                  onBlur={(e) => updateGameStateInFirestore(roomId, { customSetting: e.target.value })}
                                  placeholder="Describe your world... (e.g. A floating city in the clouds)"
                                  className="w-full bg-bg border border-border rounded-2xl p-4 text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all h-24 resize-none font-medium"
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <button
                                  onClick={() => {
                                    updateGameStateInFirestore(roomId, { isHardMode: !gameState?.isHardMode });
                                    soundManager.playClick();
                                  }}
                                  className={cn(
                                    "flex items-center justify-center gap-3 p-4 rounded-2xl border transition-all font-display font-bold text-[10px] uppercase tracking-widest",
                                    gameState?.isHardMode ? "bg-accent/10 border-accent text-accent shadow-inner" : "bg-bg border-border text-ink/40 hover:bg-ink/5"
                                  )}
                                >
                                  <Sword className="w-4 h-4" />
                                  Hard Mode
                                </button>
                                <button
                                  onClick={() => {
                                    updateGameStateInFirestore(roomId, { isPermadeath: !gameState?.isPermadeath });
                                    soundManager.playClick();
                                  }}
                                  className={cn(
                                    "flex items-center justify-center gap-3 p-4 rounded-2xl border transition-all font-display font-bold text-[10px] uppercase tracking-widest",
                                    gameState?.isPermadeath ? "bg-accent/10 border-accent text-accent shadow-inner" : "bg-bg border-border text-ink/40 hover:bg-ink/5"
                                  )}
                                >
                                  <Shield className="w-4 h-4" />
                                  Permadeath
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                {gameState.hostId === user.uid && (
                  <button
                    onClick={() => {
                      startGame();
                      soundManager.playClick();
                    }}
                    disabled={gameState.isGenerating}
                    className="px-12 py-4 bg-accent text-white font-display font-bold rounded-2xl hover:scale-[1.05] active:scale-[0.95] transition-all shadow-xl shadow-accent/20 flex items-center gap-3 text-lg"
                  >
                    {gameState.isGenerating ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sword className="w-6 h-6" />}
                    Begin Adventure
                  </button>
                )}
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-16 pb-64 md:pb-48">
                {gameState.history.map((node, i) => {
                  const isLast = i === gameState.history.length - 1;
                  return (
                    <motion.div
                      key={node.id}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "space-y-8 transition-all duration-700",
                        isLast ? "opacity-100 scale-100" : "opacity-30 scale-[0.98] blur-[1px] hover:opacity-60 hover:blur-0"
                      )}
                    >
                      {isLast && node.imageUrl && (
                        <div className="relative aspect-[21/9] rounded-3xl overflow-hidden border border-border shadow-2xl group">
                          <img 
                            src={node.imageUrl} 
                            className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" 
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent opacity-60" />
                        </div>
                      )}
                      
                      <div className="prose prose-lg prose-ink max-w-none">
                        <p className="text-2xl md:text-3xl leading-relaxed font-medium italic tracking-tight text-ink/90 first-letter:text-6xl first-letter:font-display first-letter:font-bold first-letter:mr-3 first-letter:float-left first-letter:text-accent">
                          {node.text}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
                
                {gameState.isGenerating && (
                  <div className="flex flex-col items-center gap-4 text-accent/60 py-12">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <span className="font-display font-bold text-xs uppercase tracking-[0.3em] animate-pulse">The Weaver is spinning fate...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <AnimatePresence>
            {gameState.status === 'active' && !gameState.isGenerating && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                className="absolute bottom-0 left-0 right-0 p-4 md:p-6 z-30 pointer-events-none flex flex-col justify-end"
              >
                <div className="max-w-3xl mx-auto w-full pointer-events-auto">
                  <div className="flex justify-center mb-4">
                    <button
                      onClick={() => setIsOptionsCollapsed(!isOptionsCollapsed)}
                      className="glass px-4 py-1.5 rounded-full border border-border text-[10px] font-display font-bold uppercase tracking-widest hover:bg-accent hover:text-white transition-all flex items-center gap-2 shadow-lg"
                    >
                      {isOptionsCollapsed ? "Show Options" : "Read Adventure"}
                      <ChevronRight className={cn("w-3 h-3 transition-transform", isOptionsCollapsed ? "-rotate-90" : "rotate-90")} />
                    </button>
                  </div>

                  <AnimatePresence>
                    {!isOptionsCollapsed && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0, y: 20 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: 20 }}
                        className="glass rounded-3xl border border-border p-4 space-y-4 shadow-2xl overflow-hidden"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {gameState.currentOptions.map((choice) => (
                            <button
                              key={choice.id}
                              onClick={() => {
                                handleMakeChoice(choice);
                                soundManager.playClick();
                              }}
                              className="group flex items-center gap-4 p-4 bg-ink/5 border border-border rounded-2xl hover:border-accent/50 hover:bg-accent/5 transition-all text-left"
                            >
                              <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-accent/10 group-hover:bg-accent text-accent group-hover:text-white transition-all flex-shrink-0">
                                <ChevronRight className="w-5 h-5" />
                              </div>
                              <span className="font-display font-bold text-sm tracking-tight">{choice.text}</span>
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-3 bg-ink/5 border border-border rounded-2xl p-2 focus-within:border-accent/50 transition-all">
                          <input 
                            type="text"
                            placeholder="Forge your own path..."
                            value={customActionInput}
                            onChange={(e) => setCustomActionInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && customActionInput.trim()) {
                                handleMakeChoice(undefined, customActionInput.trim());
                              }
                            }}
                            className="flex-1 bg-transparent text-sm px-4 py-2 focus:outline-none font-medium"
                          />
                          <button 
                            onClick={() => {
                              if (customActionInput.trim()) {
                                handleMakeChoice(undefined, customActionInput.trim());
                                soundManager.playClick();
                              }
                            }}
                            disabled={!customActionInput.trim()}
                            className="p-3 bg-accent text-white rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-0 shadow-lg shadow-accent/20"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="hidden lg:flex w-80 border-l border-border flex-col p-8 space-y-12 bg-bg shadow-2xl overflow-y-auto">
          <section className="space-y-6">
            <h4 className="text-[10px] font-display font-bold uppercase tracking-[0.3em] text-ink/40 flex items-center gap-3">
              <Users className="w-4 h-4 text-accent" /> The Party
            </h4>
            <div className="space-y-4">
              {gameState.players.map((p) => (
                <div key={p.uid} className="flex items-center gap-4 group">
                  <div className="relative">
                    <img 
                      src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.uid}`} 
                      className="w-12 h-12 rounded-2xl border border-border bg-ink/5 object-cover transition-transform group-hover:scale-110 shadow-sm" 
                      referrerPolicy="no-referrer"
                    />
                    {p.isHost && (
                      <div className="absolute -top-1 -right-1 bg-accent rounded-lg p-1.5 shadow-lg">
                        <Shield className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-display font-bold text-ink/80">{p.displayName}</span>
                    <span className="text-[10px] text-ink/30 uppercase tracking-widest font-medium">
                      {p.isHost ? 'Game Master' : 'Adventurer'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {gameState.npcs && gameState.npcs.length > 0 && (
            <section className="space-y-6">
              <h4 className="text-[10px] font-display font-bold uppercase tracking-[0.3em] text-ink/40 flex items-center gap-3">
                <UserIcon className="w-4 h-4 text-accent" /> NPCs
              </h4>
              <div className="space-y-4">
                {gameState.npcs.map((npc) => (
                  <div key={npc.id} className={cn("flex items-center gap-4 transition-opacity", !npc.isNearby && "opacity-40")}>
                    <div className="relative">
                      <img 
                        src={npc.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${npc.id}`} 
                        className="w-10 h-10 rounded-2xl border border-border bg-ink/5 object-cover shadow-sm" 
                        referrerPolicy="no-referrer"
                      />
                      {npc.isNearby && (
                        <div className="absolute -top-1 -right-1 bg-green-500 rounded-full w-2.5 h-2.5 border-2 border-bg shadow-lg" />
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-display font-bold text-ink/80">{npc.name}</span>
                      <span className="text-[10px] text-ink/30 uppercase tracking-widest font-medium">
                        {npc.isNearby ? "Nearby" : "Away"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="flex-1 space-y-8 flex flex-col overflow-hidden">
            <div className="flex-shrink-0">
              <h4 className="text-[10px] font-display font-bold uppercase tracking-[0.3em] text-ink/40 mb-6 flex items-center gap-3">
                <MapIcon className="w-4 h-4 text-accent" /> World Info
              </h4>
              <div className="p-5 glass rounded-2xl border border-border text-xs text-ink/60 font-medium flex items-center gap-4 shadow-inner">
                {gameState.signalStrength > 0.8 ? <SignalHigh className="w-5 h-5 text-green-500" /> :
                 gameState.signalStrength > 0.4 ? <SignalMedium className="w-5 h-5 text-yellow-500" /> :
                 gameState.signalStrength > 0.1 ? <SignalLow className="w-5 h-5 text-orange-500 animate-pulse" /> :
                 <SignalZero className="w-5 h-5 text-red-500 animate-pulse" />}
                <span>Signal: {gameState.signalStrength > 0.8 ? "Clear" : gameState.signalStrength > 0.4 ? "Weak" : "Jammed"}</span>
              </div>
            </div>

            {gameState.status === 'active' && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[10px] font-display font-bold uppercase tracking-[0.3em] text-ink/40 flex items-center gap-3">
                    <MessageSquare className="w-4 h-4 text-accent" /> Walkie-Talkie
                  </h4>
                </div>
                
                <div className="flex-1 glass border border-border rounded-2xl flex flex-col min-h-0 overflow-hidden shadow-inner">
                  <div 
                    ref={chatScrollRef}
                    className="flex-1 overflow-y-auto p-5 space-y-4 scroll-smooth scrollbar-hide"
                  >
                    {messages.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-center p-4 opacity-20">
                        <p className="text-[10px] text-ink/40 uppercase tracking-[0.3em] font-display font-bold">No transmissions...</p>
                      </div>
                    ) : (
                      messages.map((msg) => (
                        <div key={msg.id} className="space-y-1 group">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-display font-bold text-accent uppercase tracking-widest">{msg.senderName}</span>
                            <span className="text-[8px] text-ink/20 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-ink/80 leading-relaxed font-medium">
                            {garbleText(msg.text, gameState.signalStrength)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleSendMessage} className="p-4 border-t border-border flex gap-2 bg-ink/5">
                    <input 
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Over..."
                      className="flex-1 bg-transparent text-xs focus:outline-none px-2 font-medium"
                    />
                    <button type="submit" className="p-2 hover:bg-accent hover:text-white rounded-xl transition-all text-ink/40">
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              </div>
            )}
          </section>

          <button
            onClick={() => {
              setGameState(null);
              soundManager.playClick();
            }}
            onMouseEnter={() => soundManager.playHover()}
            className="w-full py-4 border border-border rounded-2xl text-[10px] font-display font-bold uppercase tracking-widest hover:bg-ink/5 transition-all flex items-center justify-center gap-3 shadow-sm mt-auto"
          >
            <LogOut className="w-4 h-4" /> Abandon Quest
          </button>
        </aside>

        {renderModals()}
      </main>
    </div>
  );
}
