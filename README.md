# react-chatapp

A cross-platform mobile chat app built with **React Native (Expo)**, backed by a small **Express + MongoDB** server. The backend replicates the API of the college NestJS chat backend (same routes, same auth header format), so the app can talk to either.

**Flow:** Phone UI (React Native) -> HTTP request (REST, JSON) -> Express server -> MongoDB -> JSON response -> UI state updates.

---

## Features

- Login with username and password. An unknown username creates an account automatically on first use.
- Home screen with three tabs: **Chats**, **Users**, **New Group**.
- Direct messages (DM) and group conversations.
- Text messages and image messages (picked from the photo library).
- New messages appear by polling the server every 3 seconds.
- Delivered/read status structure stored per participant on each message.

---

## Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Mobile client | React Native 0.88.1, React 19.3.0, Expo ~58 (SDK 58) | UI, local screen state, calls the API |
| Image access | `expo-image-picker` | Choose a photo, return it as base64 |
| API client | `ChatApiClient.js` (uses `fetch`) | One function per endpoint, attaches the auth header, turns errors into messages |
| Backend | Node.js 20 (Docker image), Express ^4.21 | Auth, validation, chat logic, REST routes |
| Database | MongoDB 7.0 (Docker image), driver `mongodb` ^6.10 | Permanent storage of users, conversations, messages |
| Packaging | Docker + docker-compose, EAS Build | Run backend + Mongo together; build an Android APK |

The phone never talks to MongoDB directly. It only calls the Express API, and the API reads and writes the database.

### Project layout

```
App.js                  All screens and app state
ChatApiClient.js        API client + BASE_URL
index.js                Expo entry point
app.json / eas.json     Expo app config / EAS build profile
backend/server.js       Express app (routes, auth, pagination)
backend/test.js         Backend self-check script
backend/Dockerfile      Backend image (node:20-alpine)
backend/docker-compose.yml   Backend + MongoDB services
```

---

## Client

### Screens and navigation
`App.js` has no navigation library. A top-level component decides what to show from state:

1. No logged-in user (`me` is null) -> **LoginScreen**
2. A conversation is open (`chat` is set) -> **ChatScreen**
3. Otherwise -> **HomeScreen**

Opening a chat sets `chat`; the Back button sets it back to null.

### State (`useState`)
- `me`: logged-in user profile. `users`: all users. `chat`: open conversation.
- Home screen: `tab`, `conversations`, `selected` (users ticked for a group), `groupName`.
- Chat screen: `messages`, `text` (input box).

Changing state triggers a re-render, which is how the UI stays in sync with data.

### Side effects (`useEffect`)
- Home screen: loads the conversation list once when it mounts.
- Chat screen: loads messages immediately, then starts `setInterval(load, 3000)`. The effect returns a cleanup function that calls `clearInterval`, so the timer stops when the user leaves the chat. Without the cleanup, timers would pile up and keep sending requests.

### Real-time behaviour: polling
The server cannot push to the app over plain REST, so the chat screen asks for the latest messages every 3 seconds. This is simple and reliable, but costs repeated requests and adds a delay of up to the 3-second interval plus network latency. WebSockets (or similar push) would remove the delay and the wasted requests. This app does not use WebSockets.

### Sending images
`ImagePicker.launchImageLibraryAsync` is called with `base64: true` and `quality: 0.4` (compressed). The image is sent inside the message as a data URI (`data:image/jpeg;base64,...`) and stored in MongoDB with the message. The chat bubble renders it with `<Image source={{ uri }}>`. The server accepts JSON bodies up to 10 MB. Storing images in the database keeps things simple but does not scale; object storage with a URL in the message would be the production approach.

### Chat list rendering
Messages are shown in an **inverted `FlatList`** (newest at the bottom), so the client reverses the oldest-first array from the server before rendering. `FlatList` uses windowed rendering: it renders only the rows near the visible area, which keeps long lists efficient. Your own messages are right-aligned and blue, others are left-aligned and grey, with the sender name shown.

### Error handling
Every API call is wrapped in `try/catch` and failures are shown with `Alert`. The API client reads the server's `message` field so the user sees a meaningful error (e.g. "Invalid password").

---

## Backend

### Data model (MongoDB, database `chatapp`)

| Collection | Main fields |
|---|---|
| `users` | `name` (unique index), `password`, `bio` |
| `conversations` | `type` (`DM` or `GROUP`), `name`, `createdAt`, `createdBy`, `participants_ids` |
| `messages` | `content`, `imageInfo`, `createdAt`, `senderId`, `conversationId`, `status` |

`status` is a map from each participant id to `{ delivered, read }`. When a message is sent, the sender is marked delivered and read, and other participants are marked false. (The app does not currently update these flags afterwards.)

### REST endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/user` | List all users |
| GET | `/user/profile` | Logged-in user's profile (or another user with `?user_id=`) |
| GET | `/conversation` | Conversations the logged-in user takes part in |
| POST | `/conversation` | Create a DM or group (`type`, `name`, `participants_ids`) |
| GET | `/message?conversation_id=` | Messages of a conversation (paginated) |
| POST | `/message` | Send a message (`conversation_id`, `content`, optional `imageInfo`) |

Responses use normal HTTP codes: 200 for reads, 201 for creates, 400 bad input, 401 bad credentials, 404 not found.

### Authentication
Every request carries `Authorization: Basic <username>:<password>`. A middleware parses it, finds the user, creates the account if the username is new, and rejects a wrong password with 401.

**Security limitations (local demo only):**
- This follows the college backend's format, where the credentials are sent as **plain text**. Standard HTTP Basic auth uses base64 of `username:password`, and base64 is only encoding, not encryption.
- Passwords are stored in the database as plain text.
- The app uses plain `http://`, and Android cleartext traffic is enabled in `app.json` for this reason.
- Because of this, the project is a local demo only. Do not use real or reused passwords, and do not deploy it publicly. A production app would use HTTPS, hashed passwords (e.g. bcrypt) and session or token auth (e.g. JWT).

### Key logic
- **DM de-duplication:** creating a DM between two users first looks for an existing DM containing both; if found it is returned instead of creating a second one. A DM must have exactly one other participant, and its name is `[DM] <other user>`.
- **Access control:** reading or sending messages in a conversation returns 404 unless the user is a participant.
- **Group creation:** needs a name and at least one other user (enforced in the UI; the server requires at least one other participant).
- **Cursor pagination:** `GET /message` returns the newest 20 messages (oldest first). If more exist, `nextCursor` holds the id of the oldest message returned; passing it as `from_message_cursor` fetches the next older 20. Because MongoDB ObjectIds increase with time, the query is `_id < cursor` sorted descending with `limit(20)`. The app currently loads only the latest page; older pages are available through the API.
- **Validation:** a message must contain text or an image; participant ids must be valid and exist.

---

## Setup

### 1. Backend (Docker)
```bash
cd backend
docker compose up -d --build    # API on port 3000, MongoDB on the internal network
```
Without Docker: start MongoDB locally, then `cd backend && npm install && npm start`. The server reads `MONGO_URL` (default `mongodb://localhost:27017`) and `PORT` (default 3000).

### 2. Mobile app
`localhost` on a phone means the phone itself, so the app must use the computer's **LAN IP**. Edit `BASE_URL` in `ChatApiClient.js` (for example `http://192.168.x.x:3000`); phone and computer must be on the same Wi-Fi.

```bash
npm install
npx expo start --lan
```
Open the project in the Expo Go app (or an emulator) using the QR code.

### 3. Android APK
```bash
eas build -p android --profile preview
```
The `preview` profile in `eas.json` produces an installable APK.

### 4. Backend self-check
```bash
cd backend
npm test        # needs MongoDB on localhost:27017
```
`test.js` starts the API against a throwaway database and checks: wrong password gives 401, DM creation and de-duplication, 20-message pages with a working cursor, empty-message rejection (400), and that a non-participant gets 404. It prints `ok` when all checks pass.

---

## Concepts used

- **React Native:** write one JavaScript/React codebase that renders real native UI components (not a WebView) on Android and iOS.
- **Expo:** a toolchain over React Native that gives ready-made native modules (image picker) and runs the app without Android Studio or Xcode.
- **Hooks:** `useState` (data that changes the UI) and `useEffect` (fetching, timers, cleanup).
- **REST + JSON:** resources behind HTTP endpoints; GET reads, POST creates.
- **async/await + `fetch`:** non-blocking network calls with `try/catch` error handling.
- **MongoDB:** document database; flexible JSON-like documents, ObjectIds as ids.
- **Docker / docker-compose:** runs the API and MongoDB together with one command and a persistent volume (`mongo_data`).

---

## Limitations and possible improvements

- Plain-text credentials, plain-text stored passwords, no HTTPS (see Authentication).
- Polling (3-second interval) instead of WebSockets.
- `BASE_URL` is hard-coded and must be edited per network.
- Images stored as base64 inside MongoDB.
- Only the newest 20 messages are shown; no "load older" in the UI yet.
- Delivered/read flags are stored but not updated after sending.
- No push notifications, message deletion or profile editing.
- Backend tests cover the API only; there are no UI tests.
