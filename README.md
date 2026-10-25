# react-chatapp

Expo (React Native) chat client + small Express/MongoDB backend, modeled on the college NestJS chat backend.

## Backend
    cd backend && docker compose up -d --build   # API on :3000
    npm test                                     # needs Mongo on :27017

## App
Set `BASE_URL` in `ChatApiClient.js` to your machine's LAN IP, then:

    npm install && npx expo start --lan
    eas build -p android --profile preview       # APK

Auth header: `Authorization: Basic <username>:<password>` (user auto-created on first use).
