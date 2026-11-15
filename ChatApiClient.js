// Minimal client for the college chat backend.
// Auth header is "Basic <username>:<password>" (plain text, NOT base64) - see backend auth.guard.ts.
// NOTE: written from the backend source because the teacher's ChatApiClient.js was not in the folder.

export const BASE_URL = 'http://10.7.10.43:3000';

let credentials = null; // "username:password"

export function setCredentials(username, password) {
  credentials = `${username}:${password}`;
}
 
async function request(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && data.message;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : msg || `Request failed (${res.status})`);
  }
  return data;
}

// GET /user -> [{ id, name, bio }]
export const getUsers = () => request('GET', '/user');

// GET /user/profile -> { id, name, bio } (the logged-in user)
export const getMyProfile = () => request('GET', '/user/profile');

// GET /conversation -> [{ id, name, type, createdAt, createdBy, participants_ids }]
export const getConversations = () => request('GET', '/conversation');

// POST /conversation -> conversation. type is 'DM' or 'GROUP'.
export const createConversation = (type, name, participantIds) =>
  request('POST', '/conversation', { type, name, participants_ids: participantIds });

// GET /message?conversation_id=... -> { data: [message], nextCursor, count } (oldest first)
export const getMessages = (conversationId) =>
  request('GET', `/message?conversation_id=${conversationId}`);

// POST /message -> message
// imageInfo is optional: a base64 data URI.
export const sendMessage = (conversationId, content, imageInfo) =>
  request('POST', '/message', { conversation_id: conversationId, content, imageInfo });
