import { auth, db } from '../firebase';
import { doc, setDoc, getDoc, updateDoc, onSnapshot, collection, addDoc, query, orderBy, limit } from 'firebase/firestore';
import { GameState, Player, StoryNode, StoryChoice, ChatMessage } from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Recursively removes undefined values from an object.
 * Firestore does not support undefined values.
 */
function removeUndefined(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(v => removeUndefined(v));
  } else if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, removeUndefined(v)])
    );
  }
  return obj;
}

export const createGameInFirestore = async (roomId: string, host: Player) => {
  const path = `games/${roomId}`;
  const gameRef = doc(db, 'games', roomId);
  const initialState: Omit<GameState, 'history'> = {
    id: roomId,
    hostId: host.uid,
    status: 'lobby',
    players: [host],
    currentOptions: [],
    currentText: "The adventure begins...",
    isGenerating: false,
    signalStrength: 1.0,
    npcs: [],
    isCompactOptions: false,
    customSetting: '',
    isHardMode: false,
    isPermadeath: false
  };
  try {
    await setDoc(gameRef, removeUndefined(initialState));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
  return { ...initialState, history: [] } as GameState;
};

export const joinGameInFirestore = async (roomId: string, player: Player) => {
  const path = `games/${roomId}`;
  const gameRef = doc(db, 'games', roomId);
  
  try {
    const gameSnap = await getDoc(gameRef);
    if (gameSnap.exists()) {
      const game = gameSnap.data() as GameState;
      const playerExists = game.players.find(p => p.uid === player.uid);
      
      if (!playerExists) {
        await updateDoc(gameRef, removeUndefined({
          players: [...game.players, { ...player, isHost: game.hostId === player.uid }]
        }));
      }
      return true;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
  return false;
};

export const updateGameStateInFirestore = async (roomId: string, updates: Partial<GameState>) => {
  const path = `games/${roomId}`;
  const gameRef = doc(db, 'games', roomId);
  try {
    // Remove history from updates if it exists, as it's now a subcollection
    const { history, ...otherUpdates } = updates as any;
    if (Object.keys(otherUpdates).length > 0) {
      await updateDoc(gameRef, removeUndefined(otherUpdates));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
};

export const addHistoryNode = async (roomId: string, node: StoryNode) => {
  const path = `games/${roomId}/history`;
  const historyRef = collection(db, 'games', roomId, 'history');
  try {
    await addDoc(historyRef, removeUndefined(node));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

export const subscribeToHistory = (roomId: string, callback: (history: StoryNode[]) => void) => {
  const path = `games/${roomId}/history`;
  const historyRef = collection(db, 'games', roomId, 'history');
  const q = query(historyRef, orderBy('timestamp', 'asc'));
  
  return onSnapshot(q, (snapshot) => {
    const history = snapshot.docs.map(doc => ({
      ...doc.data()
    } as StoryNode));
    callback(history);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, path);
  });
};

export const subscribeToGame = (roomId: string, callback: (state: GameState) => void) => {
  const path = `games/${roomId}`;
  const gameRef = doc(db, 'games', roomId);
  return onSnapshot(gameRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data() as GameState);
    }
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, path);
  });
};

export const sendChatMessage = async (roomId: string, message: Omit<ChatMessage, 'id'>) => {
  const path = `games/${roomId}/chat`;
  const chatRef = collection(db, 'games', roomId, 'chat');
  try {
    await addDoc(chatRef, removeUndefined(message));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

export const subscribeToChat = (roomId: string, callback: (messages: ChatMessage[]) => void) => {
  const path = `games/${roomId}/chat`;
  const chatRef = collection(db, 'games', roomId, 'chat');
  const q = query(chatRef, orderBy('timestamp', 'asc'), limit(50));
  
  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as ChatMessage));
    callback(messages);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, path);
  });
};
