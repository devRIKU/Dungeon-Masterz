# Dungeon-Masterz Product Specification

## 1. Overview

Dungeon-Masterz is a browser-based, multiplayer, AI-assisted storytelling game. A host creates a room, players join with a room code, each player defines a character, and the system uses Gemini to act as a Dungeon Master that generates story scenes, choices, NPCs, and narration.

The current implementation is a real-time prototype focused on atmosphere, lightweight co-op play, and fast room-based sessions.

## 2. Product Goals

- Let a small group start a shared adventure with minimal setup.
- Use AI to generate branching scenes and meaningful player choices.
- Maintain a strong mood through cinematic text, generated scene art, and voice narration.
- Keep multiplayer state synchronized in real time with Firebase.
- Support both Google sign-in and anonymous guest play.

## 3. Target Users

- Small friend groups playing lightweight online roleplay sessions.
- Solo players who want an AI-led adventure.
- Creators experimenting with collaborative narrative gameplay prototypes.

## 4. Core User Flows

### 4.1 Authentication

Users can:

- Sign in with Google.
- Play anonymously as `Nameless Wanderer`.

### 4.2 Lobby Flow

Before the game starts, users can:

- Create a new room.
- Join an existing room via room code.
- Save a personal Gemini API key.
- Edit their character name.
- Set hometown/origin.
- Set greatest fear.
- Add or generate a character portrait.

Host-only lobby actions:

- Select adventure theme.
- Define a custom setting prompt.
- Toggle hard mode.
- Toggle permadeath.
- Start the adventure.

### 4.3 Active Game Flow

During the adventure, players can:

- Read the latest AI-generated story scene.
- View current chapter number.
- See signal strength status.
- Choose from AI-generated options.
- Submit a custom action instead of a canned option.
- Send party chat messages.
- Address nearby NPCs in chat using `@name`, which converts the message into a story action.
- Open history to review previous scenes.
- Play or stop AI voice narration of the current scene.

### 4.4 Session Exit

Users can:

- Leave the current room without signing out.
- Log out entirely.
- Return to dashboard state after leaving a room.

## 5. Gameplay Rules and Behavior

### 5.1 Room Model

- Each game room is identified by a 6-character uppercase code.
- One player is the host.
- A room begins in `lobby`, moves to `active`, and may eventually support `ended`.

### 5.2 Story Generation

The host starts the story, then the system generates each new scene from:

- prior story history,
- current players and their character details,
- selected choice or custom action,
- theme,
- custom setting,
- difficulty toggles.

The AI returns:

- narrative text,
- signal strength from `0.0` to `1.0`,
- a set of story choices,
- optional NPCs.

### 5.3 Communication Distortion

- Signal strength affects the UI badge and chat readability.
- Lower signal strength garbles party chat visually by replacing characters with blocks or ellipses.
- This is a presentation effect only; the stored message remains unchanged.

### 5.4 NPC Interaction

- AI may introduce NPCs with name, description, proximity, and optional image URL.
- When a player sends chat that mentions a nearby NPC using `@npcName`, the app treats it as a custom story action.

### 5.5 Visual and Audio Atmosphere

- Each generated scene receives a derived image URL for a cinematic backdrop.
- Current implementation uses seeded `picsum.photos` placeholders instead of true AI image generation.
- Scene narration can be synthesized through Gemini TTS.
- Audio playback applies atmospheric effects client-side through the Web Audio API.

## 6. Functional Requirements

### 6.1 Authentication

- The app must support Google popup authentication.
- The app must support anonymous play without Google sign-in.

### 6.2 Gemini API Key Handling

- A Gemini API key is required before story generation, portrait generation, or narration.
- The key is stored in browser `localStorage`.
- The key can be updated through the settings modal.
- The UI should surface friendly errors for invalid key, quota, and model issues.

Note: the current UI claims the key is "synced securely with your account", but the implemented behavior stores it locally in the browser.

### 6.3 Room Management

- Authenticated users must be able to create a room.
- Authenticated users must be able to join a room if it exists.
- Room state must sync in real time for all connected players.

### 6.4 Character Setup

- Each player must have a display name.
- Players may define hometown and fear.
- Players may set portrait URL manually.
- Players may generate a portrait URL from a prompt derived from their profile.

### 6.5 Adventure Configuration

- Host must be able to set a theme.
- Host must be able to define a custom setting prompt.
- Host must be able to enable or disable hard mode.
- Host must be able to enable or disable permadeath.

Current built-in theme list:

- `80s`
- `Fantasy`
- `Cyberpunk`
- `Horror`
- `Sci-Fi`
- `Noir`
- `Mystery`
- `Space Opera`
- `Dark Fantasy`
- `Urban Fantasy`
- `Comedy`

### 6.6 Story Interaction

- The system must present current story text and a list of choices.
- Players must be able to select a choice.
- Players must be able to submit freeform actions.
- While AI content is generating, choice submission should be disabled.

### 6.7 Chat

- Players must be able to send text chat messages inside a room.
- Chat must display the latest messages in chronological order.
- Chat should auto-scroll to the newest message.

### 6.8 History

- Each generated scene must be persisted into room history.
- Users must be able to review prior scenes in a history modal.
- History should show the chapter number and any triggering choice/custom action.

### 6.9 Narration

- Users must be able to request narration for the current scene.
- Users must be able to stop active narration playback.

## 7. Non-Functional Requirements

### 7.1 Real-Time Sync

- Game state, chat, and history should update live without page refresh.

### 7.2 Responsiveness

- The app should work on modern desktop and mobile browsers.
- Story text should auto-fit its container for dramatic presentation.

### 7.3 Reliability

- Firestore writes must strip `undefined` values before persistence.
- The UI should fail gracefully when Gemini or Firestore operations fail.

### 7.4 Security

- Firestore access requires authentication.
- Users can read rooms only while authenticated.
- Only the host can create a room document.
- Chat creation requires sender identity to match the authenticated user.

## 8. System Architecture

### 8.1 Frontend

- React 19 + TypeScript
- Vite for bundling
- Framer Motion / Motion for UI transitions
- Lucide icons
- Tailwind tooling installed, with custom CSS in practice

### 8.2 Backend/Runtime

- Express dev/prod server in `server.ts`
- Vite middleware in development
- Static `dist` hosting in production
- Health endpoint at `/api/health`
- Config endpoint at `/api/config`

### 8.3 Data and Identity

- Firebase Authentication
- Cloud Firestore for multiplayer state

### 8.4 AI Services

- Gemini `gemini-2.5-flash` for story generation
- Gemini `gemini-2.5-flash-preview-tts` for narration

## 9. Data Model

### 9.1 GameState

Fields:

- `id`
- `hostId`
- `status`: `lobby | active | ended`
- `players`
- `history`
- `currentOptions`
- `currentText`
- `isGenerating`
- `signalStrength`
- `npcs`
- `isCompactOptions`
- `theme`
- `customSetting`
- `isHardMode`
- `isPermadeath`

### 9.2 Player

Fields:

- `uid`
- `displayName`
- `photoURL`
- `isHost`
- `hometown`
- `fear`
- `characterArtUrl`

### 9.3 StoryNode

Fields:

- `id`
- `text`
- `choices`
- `timestamp`
- `authorId`
- `choiceMade`
- `imageUrl`

### 9.4 ChatMessage

Fields:

- `id`
- `senderId`
- `senderName`
- `text`
- `timestamp`
- `isGarbled`
- `isNPC`

### 9.5 NPC

Fields:

- `id`
- `name`
- `description`
- `photoURL`
- `isNearby`

## 10. Firestore Structure

### 10.1 Top-Level Collections

- `games/{roomId}`
- `users/{userId}`

### 10.2 Game Subcollections

- `games/{roomId}/chat/{messageId}`
- `games/{roomId}/history/{nodeId}`

### 10.3 User Settings

- `users/{userId}/settings/{settingId}`

Note: helper functions exist for user settings, but the current Gemini API key flow is not using them.

## 11. Security Rules Summary

Implemented Firestore rules currently allow:

- authenticated reads on games,
- host-only game creation,
- authenticated updates on a limited set of game fields,
- authenticated chat creation with sender validation,
- authenticated history creation,
- owner-only writes to user settings.

Important limitation:

- The prototype update rule is intentionally loose to allow multiplayer progression and is not hardened for production-grade authorization.

## 12. Current Limitations and Gaps

- No authoritative server-side game engine; clients directly trigger state mutations.
- No conflict resolution for simultaneous player actions.
- No explicit endgame flow is implemented.
- No reconnect/session recovery UX beyond Firestore resubscription.
- Generated scene images are placeholders, not actual Gemini image output.
- The Express server imports Socket.IO dependencies indirectly through the package, but real-time sync currently relies only on Firestore.
- The README is generic and does not document the actual product behavior.
- UI text suggests API keys are account-synced, but implementation stores them locally.
- `isCompactOptions` exists in data/rules but is not meaningfully exposed in gameplay UI.
- Firestore rules do not currently include `customSetting`, `isHardMode`, or `isPermadeath` in the allowed update key set, which may block some host settings updates depending on rule enforcement.

## 13. Recommended Next Milestones

- Align Firestore rules with all fields used by the current client.
- Move sensitive settings and provider configuration copy to match actual behavior.
- Add a true end-of-game state and restart flow.
- Add turn ownership or host arbitration for simultaneous actions.
- Replace placeholder image generation with a real image provider.
- Persist and restore richer player preferences and room metadata.
- Add tests for story flow, room creation, and Firestore service logic.

## 14. Success Criteria

The current product can be considered successful as a prototype if:

- a user can sign in or play anonymously,
- a host can create a room and invite others,
- players can configure characters and join the same lobby,
- the host can start an AI-generated adventure,
- players can progress the story via choices or custom actions,
- chat, history, and state remain synchronized in real time,
- narration and atmospheric presentation increase immersion without blocking play.
