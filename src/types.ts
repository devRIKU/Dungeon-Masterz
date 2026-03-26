export interface Player {
  uid: string;
  displayName: string;
  photoURL?: string;
  isHost?: boolean;
  hometown?: string;
  fear?: string;
  characterArtUrl?: string;
}

export interface NPC {
  id: string;
  name: string;
  description: string;
  photoURL?: string;
  isNearby: boolean;
}

export interface StoryChoice {
  text: string;
  id: string;
}

export interface StoryNode {
  id: string;
  text: string;
  choices: StoryChoice[];
  timestamp: number;
  authorId?: string;
  choiceMade?: string;
  imageUrl?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isGarbled?: boolean;
  isNPC?: boolean;
}

export interface GameState {
  id: string;
  hostId: string;
  status: 'lobby' | 'active' | 'ended';
  players: Player[];
  history: StoryNode[];
  currentOptions: StoryChoice[];
  currentText: string;
  isGenerating: boolean;
  signalStrength: number; // 0 to 1, where 0 is jammed/too far
  npcs?: NPC[];
  isCompactOptions?: boolean;
  theme?: string;
  customSetting?: string;
  isHardMode?: boolean;
  isPermadeath?: boolean;
}
