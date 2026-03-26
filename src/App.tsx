import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle } from './firebase';
import { GameState, Player, StoryNode, StoryChoice, ChatMessage } from './types';
import { generateStoryPart, generateAudio, generateImage } from './services/geminiService';
import { createGameInFirestore, joinGameInFirestore, updateGameStateInFirestore, subscribeToGame, sendChatMessage, subscribeToChat, addHistoryNode, subscribeToHistory } from './services/gameService';
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
  Radio,
  Info,
  X,
  Settings,
  History,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const garbleText = (text: string, strength: number) => {
  if (strength >= 1) return text;
  return text.split('').map(char => {
    if (char === ' ') return ' ';
    return Math.random() > strength ? (Math.random() > 0.5 ? '...' : '█') : char;
  }).join('');
};

export default function App() {
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
    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
    if (!hasSeenTutorial) {
      setShowTutorial(true);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
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

  const createGame = async () => {
    if (!user) return;
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
      setError("Failed to start the adventure. Please try again.");
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
      setError("The DM is momentarily speechless. Try again.");
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
        // Fallback to local speech if Gemini fails
        speakText(gameState.currentText);
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
    } finally {
      setIsGeneratingArt(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] flex flex-col items-center justify-center p-4 font-serif relative overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-red-900/30 blur-[100px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/30 blur-[100px] rounded-full" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="z-10 text-center max-w-md w-full"
        >
          <div className="mb-8 flex justify-center">
            <div className="p-4 bg-red-950/30 border border-red-900/50 rounded-2xl shadow-2xl shadow-red-900/20">
              <Sword className="w-16 h-16 text-red-500" />
            </div>
          </div>
          <h1 className="text-5xl font-bold mb-4 tracking-tighter bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent uppercase animate-glitch cursor-default">
            Dungeon Master AI
          </h1>
          <p className="text-gray-400 mb-12 text-lg leading-relaxed italic">
            "Step into the realm of infinite stories, where every choice weaves a new destiny."
          </p>
          
          <button
            onClick={() => {
              signInWithGoogle();
              soundManager.playClick();
            }}
            onMouseEnter={() => soundManager.playHover()}
            className="w-full py-4 px-6 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-all flex items-center justify-center gap-3 group shadow-xl shadow-white/5"
          >
            <Shield className="w-5 h-5 group-hover:rotate-12 transition-transform" />
            Begin Your Journey
          </button>
        </motion.div>
      </div>
    );
  }

  const renderModals = () => (
    <>
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-[#0a0a0a] border border-gray-800 rounded-3xl p-8 space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Settings className="w-5 h-5" /> Adventure Settings
                </h3>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-gray-800 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {!gameState ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                    <Settings className="w-12 h-12" />
                    <p className="text-lg font-serif italic">No active adventure settings.</p>
                    <p className="text-sm">Join or create an adventure to customize your experience.</p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Adventure Theme</label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {(['80s', 'fantasy', 'cyberpunk', 'horror'] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => updateGameStateInFirestore(roomId, { theme: t })}
                            className={cn(
                              "py-3 rounded-xl border text-sm font-bold capitalize transition-all",
                              (gameState?.theme || '80s') === t 
                                ? "bg-red-600 border-red-500 text-white" 
                                : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700"
                            )}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Custom Setting / Prompt</label>
                      <textarea
                        value={gameState?.customSetting || ''}
                        onChange={(e) => updateGameStateInFirestore(roomId, { customSetting: e.target.value })}
                        placeholder="e.g. Set in a floating city, or everyone is a cat..."
                        className="w-full mt-2 bg-gray-900 border border-gray-800 rounded-xl p-3 text-sm focus:outline-none focus:border-red-500 transition-colors h-24 resize-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => updateGameStateInFirestore(roomId, { isHardMode: !gameState?.isHardMode })}
                        className={cn(
                          "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                          gameState?.isHardMode ? "bg-red-950/30 border-red-500 text-red-500" : "bg-gray-900 border-gray-800 text-gray-500"
                        )}
                      >
                        <Sword className="w-5 h-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Hard Mode</span>
                      </button>
                      <button
                        onClick={() => updateGameStateInFirestore(roomId, { isPermadeath: !gameState?.isPermadeath })}
                        className={cn(
                          "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                          gameState?.isPermadeath ? "bg-red-950/30 border-red-500 text-red-500" : "bg-gray-900 border-gray-800 text-gray-500"
                        )}
                      >
                        <Shield className="w-5 h-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Permadeath</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-full py-4 bg-white text-black rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                Save Changes
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isHistoryOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="w-full max-w-4xl h-[80vh] bg-[#0a0a0a] border border-gray-800 rounded-3xl flex flex-col overflow-hidden"
            >
              <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-black/40">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <History className="w-5 h-5" /> Adventure History
                </h3>
                <button onClick={() => setIsHistoryOpen(false)} className="p-2 hover:bg-gray-800 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-12">
                {!gameState ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                    <History className="w-12 h-12" />
                    <p className="text-lg font-serif italic">No active adventure history to display.</p>
                    <p className="text-sm">Join or create an adventure to start recording your journey.</p>
                  </div>
                ) : gameState.history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                    <ScrollText className="w-12 h-12" />
                    <p className="text-lg font-serif italic">The scroll is empty...</p>
                    <p className="text-sm">Your journey has not yet begun.</p>
                  </div>
                ) : (
                  gameState.history.map((node, idx) => (
                    <div key={node.id} className="space-y-4">
                      <div className="flex items-center gap-4 text-xs font-bold text-gray-500 uppercase tracking-widest">
                        <span className="w-8 h-px bg-gray-800" />
                        Chapter {idx + 1}
                        <span className="flex-1 h-px bg-gray-800" />
                      </div>
                      
                      <div className="grid lg:grid-cols-2 gap-8 items-start">
                        <div className="space-y-4">
                          <p className="text-lg leading-relaxed text-gray-300 font-serif italic">
                            {node.text}
                          </p>
                          {node.choiceMade && (
                            <div className="flex items-center gap-2 text-red-500 font-bold text-sm">
                              <ChevronRight className="w-4 h-4" />
                              Action: {node.choiceMade}
                            </div>
                          )}
                        </div>
                        {node.imageUrl && (
                          <div className="aspect-video rounded-xl overflow-hidden border border-gray-800">
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
    </>
  );

  if (!gameState) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] p-6 font-serif flex flex-col items-center justify-center">
        <div className="max-w-md w-full space-y-8">
          <div className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-3">
              <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border border-gray-800" />
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">Adventurer</p>
                <p className="font-bold">{user.displayName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  setIsHistoryOpen(true);
                  soundManager.playClick();
                }}
                onMouseEnter={() => soundManager.playHover()}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500"
                title="History"
              >
                <History className="w-5 h-5" />
              </button>
              <button 
                onClick={() => {
                  setIsSettingsOpen(true);
                  soundManager.playClick();
                }}
                onMouseEnter={() => soundManager.playHover()}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
              <button 
                onClick={() => {
                  auth.signOut();
                  soundManager.playClick();
                }}
                onMouseEnter={() => soundManager.playHover()}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              >
                <LogOut className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          </div>

          <div className="grid gap-4">
            <button
              onClick={() => {
                createGame();
                soundManager.playClick();
              }}
              onMouseEnter={() => soundManager.playHover()}
              className="group relative p-6 bg-[#111] border border-gray-800 rounded-2xl hover:border-red-900/50 transition-all text-left overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Sword className="w-16 h-16" />
              </div>
              <h3 className="text-xl font-bold mb-1">New Adventure</h3>
              <p className="text-sm text-gray-500">Embark on a personal quest through the unknown.</p>
            </button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-[#0a0a0a] px-2 text-gray-500 font-bold tracking-widest">Or Join Party</span>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter Room Code"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="flex-1 bg-[#111] border border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:border-white/20 transition-colors uppercase tracking-widest font-mono"
              />
              <button
                onClick={() => {
                  joinGame(roomId);
                  soundManager.playClick();
                }}
                onMouseEnter={() => soundManager.playHover()}
                className="px-6 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-all"
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
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-serif flex flex-col h-screen overflow-hidden">
      <header className="p-4 border-b border-gray-900 flex items-center justify-between bg-[#0a0a0a]/80 backdrop-blur-md z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs font-bold tracking-widest uppercase font-mono">{roomId}</span>
            <button onClick={copyRoomCode} className="ml-1 hover:text-white transition-colors">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsPartyOpen(true)}
            className="lg:hidden p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500"
          >
            <Users className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsChatOpen(true)}
            className="lg:hidden p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          {gameState.status === 'active' && (
            <button 
              onClick={playStoryAudio}
              disabled={isAudioLoading || gameState.isGenerating}
              className="lg:hidden p-2 hover:bg-white/5 rounded-lg transition-colors text-red-500 disabled:opacity-50"
            >
              {isAudioLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Volume2 className="w-5 h-5" />}
            </button>
          )}
          <div className="hidden sm:flex -space-x-2 overflow-hidden">
            {gameState.players.map((p) => (
              <img
                key={p.uid}
                src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.uid}`}
                title={p.displayName}
                className="inline-block h-8 w-8 rounded-full ring-2 ring-[#0a0a0a] bg-gray-800"
              />
            ))}
          </div>
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
                  <Radio className={cn("w-4 h-4", gameState.signalStrength < 0.5 ? "text-red-500 animate-pulse" : "text-green-500")} />
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

        <div className="flex-1 flex flex-col overflow-hidden">
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth"
          >
            {gameState.status === 'lobby' ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                <ScrollText className="w-16 h-16 text-gray-700" />
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold tracking-tight">The Gathering Room</h2>
                  <p className="text-gray-500 max-w-xs mx-auto italic">
                    Wait for your companions to join before the Dungeon Master begins the tale.
                  </p>
                </div>

                <div className="w-full max-w-md p-6 bg-[#111] border border-gray-800 rounded-2xl space-y-6 text-left">
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <Shield className="w-4 h-4 text-red-500" /> Character Quiz
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Character Name</label>
                        <input 
                          type="text" 
                          placeholder="Your Name"
                          defaultValue={gameState.players.find(p => p.uid === user.uid)?.displayName || ''}
                          onBlur={(e) => saveQuiz(
                            gameState.players.find(p => p.uid === user.uid)?.hometown || '', 
                            gameState.players.find(p => p.uid === user.uid)?.fear || '',
                            e.target.value
                          )}
                          className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 mt-1 focus:border-red-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Where are you from?</label>
                        <input 
                          type="text" 
                          placeholder="Hometown"
                          defaultValue={gameState.players.find(p => p.uid === user.uid)?.hometown || ''}
                          onBlur={(e) => saveQuiz(
                            e.target.value, 
                            gameState.players.find(p => p.uid === user.uid)?.fear || '',
                            gameState.players.find(p => p.uid === user.uid)?.displayName
                          )}
                          className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 mt-1 focus:border-red-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase tracking-widest text-gray-500">What is your greatest fear?</label>
                        <input 
                          type="text" 
                          placeholder="Your fear..."
                          defaultValue={gameState.players.find(p => p.uid === user.uid)?.fear || ''}
                          onBlur={(e) => saveQuiz(
                            gameState.players.find(p => p.uid === user.uid)?.hometown || '', 
                            e.target.value,
                            gameState.players.find(p => p.uid === user.uid)?.displayName,
                            gameState.players.find(p => p.uid === user.uid)?.characterArtUrl
                          )}
                          className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 mt-1 focus:border-red-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Character Art URL</label>
                        <div className="flex gap-2 mt-1">
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
                            className="flex-1 bg-black border border-gray-800 rounded-lg px-3 py-2 focus:border-red-500 transition-colors"
                          />
                          <button
                            onClick={() => {
                              generateCharacterArt();
                              soundManager.playClick();
                            }}
                            onMouseEnter={() => soundManager.playHover()}
                            disabled={isGeneratingArt}
                            className="px-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-800 rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
                          >
                            {isGeneratingArt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            AI Gen
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {gameState.hostId === user.uid && (
                    <div className="space-y-4 pt-4 border-t border-gray-800">
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <Settings className="w-4 h-4 text-blue-500" /> Adventure Customization
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Adventure Theme</label>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {(['80s', 'fantasy', 'cyberpunk', 'horror'] as const).map((t) => (
                              <button
                                key={t}
                                onClick={() => {
                                  updateGameStateInFirestore(roomId, { theme: t });
                                  soundManager.playClick();
                                }}
                                onMouseEnter={() => soundManager.playHover()}
                                className={cn(
                                  "py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all",
                                  (gameState?.theme || '80s') === t 
                                    ? "bg-red-600 border-red-500 text-white" 
                                    : "bg-black border-gray-800 text-gray-500 hover:border-gray-700"
                                )}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Custom Setting / Prompt</label>
                          <textarea
                            value={gameState?.customSetting || ''}
                            onChange={(e) => updateGameStateInFirestore(roomId, { customSetting: e.target.value })}
                            placeholder="e.g. Set in a floating city, or everyone is a cat..."
                            className="w-full mt-2 bg-black border border-gray-800 rounded-xl p-3 text-xs focus:outline-none focus:border-red-500 transition-colors h-20 resize-none"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            onClick={() => {
                              updateGameStateInFirestore(roomId, { isHardMode: !gameState?.isHardMode });
                              soundManager.playClick();
                            }}
                            onMouseEnter={() => soundManager.playHover()}
                            className={cn(
                              "flex items-center justify-center gap-2 p-3 rounded-xl border transition-all",
                              gameState?.isHardMode ? "bg-red-950/30 border-red-500 text-red-500" : "bg-black border-gray-800 text-gray-500"
                            )}
                          >
                            <Sword className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Hard Mode</span>
                          </button>
                          <button
                            onClick={() => {
                              updateGameStateInFirestore(roomId, { isPermadeath: !gameState?.isPermadeath });
                              soundManager.playClick();
                            }}
                            onMouseEnter={() => soundManager.playHover()}
                            className={cn(
                              "flex items-center justify-center gap-2 p-3 rounded-xl border transition-all",
                              gameState?.isPermadeath ? "bg-red-950/30 border-red-500 text-red-500" : "bg-black border-gray-800 text-gray-500"
                            )}
                          >
                            <Shield className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Permadeath</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {gameState.hostId === user.uid && (
                  <button
                    onClick={() => {
                      startGame();
                      soundManager.playClick();
                    }}
                    onMouseEnter={() => soundManager.playHover()}
                    disabled={gameState.isGenerating}
                    className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-900/20 flex items-center gap-2"
                  >
                    {gameState.isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sword className="w-5 h-5" />}
                    Start Adventure
                  </button>
                )}
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-12">
                {gameState.history.map((node, i) => {
                  const isLast = i === gameState.history.length - 1;
                  return (
                    <motion.div
                      key={node.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "space-y-6",
                        isLast ? "opacity-100" : "opacity-40 grayscale-[0.5]"
                      )}
                    >
                      {isLast && node.imageUrl && (
                        <div className="relative aspect-video rounded-2xl overflow-hidden border border-gray-800 shadow-2xl">
                          <img 
                            src={node.imageUrl} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        </div>
                      )}
                      
                      <div className="prose prose-invert max-w-none">
                        <p className="text-xl leading-relaxed font-serif italic first-letter:text-4xl first-letter:font-bold first-letter:mr-2 first-letter:float-left">
                          {node.text}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
                
                {gameState.isGenerating && (
                  <div className="max-w-2xl mx-auto flex items-center gap-3 text-gray-500 italic">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>The Dungeon Master is weaving the next thread...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <AnimatePresence>
            {gameState.status === 'active' && !gameState.isGenerating && (
              <motion.div
                initial={{ y: 100 }}
                animate={{ y: 0 }}
                exit={{ y: 100 }}
                className="p-4 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent"
              >
                <div className={cn(
                  "max-w-2xl mx-auto grid gap-2",
                  gameState.isCompactOptions ? "grid-cols-2" : "grid-cols-1"
                )}>
                  {gameState.currentOptions.map((choice) => (
                    <button
                      key={choice.id}
                      onClick={() => {
                        handleMakeChoice(choice);
                        soundManager.playClick();
                      }}
                      onMouseEnter={() => soundManager.playHover()}
                      className={cn(
                        "group flex items-center gap-3 bg-[#111] border border-gray-800 rounded-xl hover:border-white/20 hover:bg-[#1a1a1a] transition-all text-left",
                        gameState.isCompactOptions ? "p-2 text-xs" : "p-3 text-sm"
                      )}
                    >
                      <div className={cn(
                        "flex items-center justify-center rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors flex-shrink-0",
                        gameState.isCompactOptions ? "w-6 h-6" : "w-8 h-8"
                      )}>
                        <ChevronRight className={cn(gameState.isCompactOptions ? "w-3 h-3" : "w-4 h-4")} />
                      </div>
                      <span className="font-medium line-clamp-2">{choice.text}</span>
                    </button>
                  ))}

                  <div className={cn(
                    "flex items-center gap-2 bg-[#111] border border-gray-800 rounded-xl p-1.5 focus-within:border-white/20 transition-all",
                    gameState.isCompactOptions ? "col-span-2" : "col-span-1"
                  )}>
                    <input 
                      type="text"
                      placeholder="Or do something else..."
                      value={customActionInput}
                      onChange={(e) => setCustomActionInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customActionInput.trim()) {
                          handleMakeChoice(undefined, customActionInput.trim());
                        }
                      }}
                      className="flex-1 bg-transparent text-xs px-2 py-1 focus:outline-none"
                    />
                    <button 
                      onClick={() => {
                        handleMakeChoice(undefined, customActionInput.trim());
                        soundManager.playClick();
                      }}
                      onMouseEnter={() => soundManager.playHover()}
                      disabled={!customActionInput.trim()}
                      className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-all disabled:opacity-0"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="hidden lg:flex w-80 border-l border-gray-900 flex-col p-6 space-y-8 bg-[#0a0a0a]">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
                <Users className="w-3 h-3" /> The Party
              </h4>
              <button 
                onClick={() => updateGameStateInFirestore(roomId, { isCompactOptions: !gameState.isCompactOptions })}
                className="text-[10px] uppercase tracking-widest text-gray-600 hover:text-white transition-colors"
              >
                {gameState.isCompactOptions ? "Expand" : "Compact"}
              </button>
            </div>
            <div className="space-y-3">
              {gameState.players.map((p, idx) => (
                <div key={p.uid} className="flex items-center gap-3">
                  <div className="relative">
                    <img 
                      src={p.characterArtUrl || p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.uid}`} 
                      className="w-8 h-8 rounded-full border border-gray-800 bg-gray-900 object-cover" 
                    />
                    {p.isHost && (
                      <div className="absolute -top-1 -right-1 bg-yellow-500 rounded-full p-0.5">
                        <Shield className="w-2 h-2 text-black" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{p.displayName}</span>
                    <span className="text-[10px] text-gray-600 uppercase tracking-tighter">
                      {p.hometown || 'Unknown Origin'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {gameState.npcs && gameState.npcs.length > 0 && (
            <section>
              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2">
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
            </section>
          )}

          <section className="flex-1 space-y-6 flex flex-col overflow-hidden">
            <div className="flex-shrink-0">
              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2">
                <MapIcon className="w-3 h-3" /> World Info
              </h4>
              <div className="p-4 bg-[#111] rounded-xl border border-gray-800 text-sm text-gray-400 italic flex items-center gap-3">
                <Radio className={cn("w-4 h-4", gameState.signalStrength < 0.5 ? "text-red-500 animate-pulse" : "text-green-500")} />
                <span>Signal: {gameState.signalStrength > 0.8 ? "Clear" : gameState.signalStrength > 0.4 ? "Weak" : "Jammed"}</span>
              </div>
            </div>

            {gameState.status === 'active' && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
                    <MessageSquare className="w-3 h-3" /> Walkie-Talkie
                  </h4>
                  <button
                    onClick={playStoryAudio}
                    disabled={isAudioLoading || gameState.isGenerating}
                    className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors text-gray-500 hover:text-red-500 disabled:opacity-50"
                  >
                    {isAudioLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                  </button>
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
              </div>
            )}
          </section>

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
        </aside>

        {renderModals()}
      </main>
    </div>
  );
}
