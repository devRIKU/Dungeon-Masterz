import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from '@firebase/auth';
import {
  Check,
  Copy,
  History,
  Loader2,
  LogOut,
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
import { generateAudio, generateImage, generateStoryPart, setApiKey } from './services/geminiService';
import type { ChatMessage, GameState, Player, StoryChoice, StoryNode } from './types';

const THEME_OPTIONS = ['80s', 'Fantasy', 'Cyberpunk', 'Horror', 'Sci-Fi', 'Noir', 'Mystery', 'Space Opera', 'Dark Fantasy', 'Urban Fantasy', 'Comedy'];

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
    return 'Your Gemini API key is missing, invalid, or does not have access. Update it in Settings and try again.';
  }
  if (normalized.includes('quota') || normalized.includes('rate limit') || normalized.includes('429')) {
    return 'Gemini is rate-limiting this request right now. Wait a moment and try again.';
  }
  if (normalized.includes('model') || normalized.includes('unsupported')) {
    return 'The story model rejected the request. Try again with the saved settings.';
  }
  return message.length > 150 ? `${message.slice(0, 147)}...` : message;
};

function SignalBadge({ strength }: { strength: number }) {
  if (strength > 0.8) {
    return <span className="signal-badge"><SignalHigh className="h-4 w-4 text-emerald-400" />Clear Signal</span>;
  }
  if (strength > 0.4) {
    return <span className="signal-badge"><SignalMedium className="h-4 w-4 text-amber-300" />Weak Signal</span>;
  }
  if (strength > 0.1) {
    return <span className="signal-badge"><SignalLow className="h-4 w-4 text-orange-300" />Fragmented</span>;
  }
  return <span className="signal-badge"><SignalZero className="h-4 w-4 text-red-300" />Jammed</span>;
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
  const [userApiKey, setUserApiKey] = useState('');
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isNarrationActive, setIsNarrationActive] = useState(false);
  const [isGeneratingArt, setIsGeneratingArt] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const currentNode = gameState?.history?.[gameState.history.length - 1] ?? null;
  const currentTheme = gameState?.theme || '80s';
  const currentStoryText = currentNode?.text || gameState?.currentText || 'The veil is still.';
  const chapterNumber = Math.max(gameState?.history.length || 0, gameState?.status === 'active' ? 1 : 0);

  useEffect(() => {
    const cachedKey = localStorage.getItem('gemini_api_key');
    if (cachedKey) {
      setUserApiKey(cachedKey);
      setApiKey(cachedKey);
    }
  }, []);

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
    if (userApiKey.trim()) {
      setApiKey(userApiKey.trim());
      return true;
    }

    setIsSettingsOpen(true);
    setError('A Gemini API key is required before the story can continue.');
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
    if (!userApiKey.trim()) {
      setIsSettingsOpen(true);
    }
  };

  const handleSaveUserApiKey = async () => {
    const trimmed = userApiKey.trim();
    if (!trimmed) {
      setError('Paste a Gemini API key before saving.');
      return;
    }

    setIsSavingApiKey(true);
    try {
      localStorage.setItem('gemini_api_key', trimmed);
      setUserApiKey(trimmed);
      setApiKey(trimmed);
      setIsSettingsOpen(false);
      soundManager.playSuccess();
    } catch (saveError) {
      console.error(saveError);
      setError('Failed to save the API key.');
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

  if (!user) {
    return (
      <div className="app-shell">
        <div className="landing-shell">
          <div className="landing-copy">
            <p className="eyebrow">Occult Story Engine</p>
            <h1 className="landing-title">Runescribe</h1>
            <p className="landing-subtitle">
              One haunted scene at a time. No endless transcript, no dead UI weight, just the current chapter framed like a ritual.
            </p>
          </div>

          <div className="panel landing-panel">
            <label className="eyebrow" htmlFor="landing-api-key">Gemini API key</label>
            <input
              id="landing-api-key"
              type="password"
              value={userApiKey}
              onChange={(event) => setUserApiKey(event.target.value)}
              className="ritual-input"
              placeholder="Paste your key to unlock narration and story generation"
            />

            <button type="button" onClick={handleSaveUserApiKey} disabled={isSavingApiKey || !userApiKey.trim()} className="primary-button">
              {isSavingApiKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Save key
            </button>

            <button
              type="button"
              onClick={async () => {
                try {
                  await signInWithGoogle();
                } catch (loginError) {
                  console.error(loginError);
                  setError('Google sign-in failed.');
                }
              }}
              className="secondary-button"
            >
              <Sparkles className="h-4 w-4" />
              Enter with Google
            </button>

            <button type="button" onClick={handlePlayAnonymous} className="ghost-button">
              <Wand2 className="h-4 w-4" />
              Wander anonymously
            </button>
          </div>
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

  if (!gameState) {
    return (
      <div className="app-shell">
        <div className="topbar">
          <div>
            <p className="eyebrow">Connected Wanderer</p>
            <h2 className="topbar-title">{user.displayName || 'Adventurer'}</h2>
          </div>
          <button type="button" onClick={logout} className="icon-button">
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        <div className="setup-grid">
          <section className="story-stage story-stage--landing">
            <div className="story-stage-backdrop" />
            <div className="story-stage-overlay" />
            <div className="story-stage-inner">
              <p className="eyebrow">Before The First Omen</p>
              <h1 className="scene-title">Choose whether to summon a new room or answer an existing signal.</h1>
              <p className="scene-subtitle">
                Your campaigns now play in a fixed story frame with cinematic narration, responsive typography, and a single immersive choice deck.
              </p>
            </div>
          </section>

          <section className="setup-column">
            <div className="panel">
              <p className="eyebrow">Start Fresh</p>
              <h3 className="panel-title">Forge a new room</h3>
              <button type="button" onClick={createGame} disabled={isCreatingGame} className="primary-button">
                {isCreatingGame ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isCreatingGame ? 'Forging the room...' : 'Create adventure'}
              </button>
            </div>

            <div className="panel">
              <p className="eyebrow">Answer A Signal</p>
              <h3 className="panel-title">Join by room code</h3>
              <div className="join-row">
                <input
                  type="text"
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value.toUpperCase())}
                  placeholder="ROOM CODE"
                  className="ritual-input ritual-input--compact"
                />
                <button type="button" onClick={joinGame} className="secondary-button">
                  Join
                </button>
              </div>
            </div>

            <div className="panel">
              <p className="eyebrow">Narration Access</p>
              <h3 className="panel-title">Saved API key</h3>
              <div className="join-row">
                <input
                  type="password"
                  value={userApiKey}
                  onChange={(event) => setUserApiKey(event.target.value)}
                  placeholder="Gemini API key"
                  className="ritual-input ritual-input--compact"
                />
                <button type="button" onClick={handleSaveUserApiKey} className="ghost-button">
                  Save
                </button>
              </div>
            </div>
          </section>
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-group">
          <div>
            <p className="eyebrow">Active Room</p>
            <h1 className="topbar-title">Runescribe</h1>
          </div>
          <button type="button" onClick={copyRoomCode} className="room-pill">
            <Radio className="h-3.5 w-3.5" />
            {roomId}
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="topbar-actions">
          <button type="button" onClick={() => setIsHistoryOpen(true)} className="icon-button">
            <History className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setIsSettingsOpen(true)} className="icon-button">
            <Settings className="h-4 w-4" />
          </button>
          <button type="button" onClick={playStoryAudio} className="icon-button" disabled={isAudioLoading || gameState.isGenerating}>
            {isAudioLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isNarrationActive ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={logout} className="icon-button icon-button--danger">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

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

              {gameState.status === 'lobby' ? (
                <div className="lobby-scene">
                  <h2 className="scene-title">The room is gathering breath.</h2>
                  <p className="scene-subtitle">
                    Shape your character, tune the setting, and let the host begin when the circle is ready.
                  </p>
                </div>
              ) : (
                <div key={currentNode?.id || gameState.currentText} className="story-frame">
                  {currentNode?.choiceMade ? <span className="choice-made">Last move: {currentNode.choiceMade}</span> : null}
                  <StoryViewport text={currentStoryText} className="story-viewport-shell" />
                </div>
              )}
            </div>
          </div>

          {gameState.status === 'lobby' ? (
            <section className="lobby-grid">
              <div className="panel">
                <p className="eyebrow">Your Character</p>
                <h3 className="panel-title">Identity, fear, and portrait</h3>
                <div className="form-grid">
                  <input
                    type="text"
                    defaultValue={myPlayer?.displayName || user.displayName || ''}
                    placeholder="Character name"
                    className="ritual-input ritual-input--compact"
                    onBlur={(event) => void savePlayerProfile({ displayName: event.target.value })}
                  />
                  <input
                    type="text"
                    defaultValue={myPlayer?.hometown || ''}
                    placeholder="Origin or hometown"
                    className="ritual-input ritual-input--compact"
                    onBlur={(event) => void savePlayerProfile({ hometown: event.target.value })}
                  />
                  <input
                    type="text"
                    defaultValue={myPlayer?.fear || ''}
                    placeholder="Greatest fear"
                    className="ritual-input ritual-input--compact"
                    onBlur={(event) => void savePlayerProfile({ fear: event.target.value })}
                  />
                  <div className="join-row">
                    <input
                      type="text"
                      defaultValue={myPlayer?.characterArtUrl || ''}
                      placeholder="Portrait URL or generate one"
                      className="ritual-input ritual-input--compact"
                      onBlur={(event) => void savePlayerProfile({ characterArtUrl: event.target.value })}
                    />
                    <button type="button" onClick={generateCharacterArt} className="ghost-button" disabled={isGeneratingArt}>
                      {isGeneratingArt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      Portrait
                    </button>
                  </div>
                </div>
              </div>

              {gameState.hostId === user.uid ? (
                <div className="panel">
                  <p className="eyebrow">Host Controls</p>
                  <h3 className="panel-title">Shape the world before it opens</h3>
                  <div className="form-grid">
                    <select
                      value={currentTheme}
                      onChange={(event) => void updateGameStateInFirestore(roomId, { theme: event.target.value })}
                      className="ritual-input ritual-input--compact"
                    >
                      {THEME_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                    <textarea
                      defaultValue={gameState.customSetting || ''}
                      onBlur={(event) => void updateGameStateInFirestore(roomId, { customSetting: event.target.value })}
                      className="ritual-input ritual-input--compact ritual-textarea"
                      placeholder="Describe the setting, tone, or weird threat hanging over the room."
                    />
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
                    <button type="button" onClick={startGame} disabled={gameState.isGenerating} className="primary-button">
                      {gameState.isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Begin adventure
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <OptionDeck
              choices={gameState.currentOptions}
              customActionInput={customActionInput}
              onCustomActionChange={setCustomActionInput}
              onChoice={(choice) => void handleMakeChoice(choice)}
              onSubmitCustomAction={() => void handleMakeChoice(undefined, customActionInput.trim())}
              disabled={gameState.isGenerating}
            />
          )}
        </section>

        <aside className="rail-column">
          <section className="panel">
            <p className="eyebrow">Party</p>
            <h3 className="panel-title">Who is in the room</h3>
            <div className="avatar-list">
              {gameState.players.map((player) => (
                <div key={player.uid} className="avatar-row">
                  <img
                    src={player.characterArtUrl || player.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${player.uid}`}
                    className="avatar-image"
                    referrerPolicy="no-referrer"
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
              <div className="avatar-list">
                {gameState.npcs.map((npc) => (
                  <div key={npc.id} className={cn('avatar-row', !npc.isNearby && 'avatar-row--dim')}>
                    <img
                      src={npc.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${npc.id}`}
                      className="avatar-image avatar-image--small"
                      referrerPolicy="no-referrer"
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

              <div className="form-grid">
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
                <button type="button" onClick={leaveCurrentGame} className="ghost-button">
                  <LogOut className="h-4 w-4" />
                  Leave current room
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

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
