# CipherLink E2EE 🛡️

**CipherLink** is a zero-trust, peer-to-peer encrypted communications platform built for browser-based private collaboration. Operating entirely client-side, it derives session keys using deterministic 6-digit passbox codes, enabling secure real-time messaging, chunked file streaming, encrypted voice/video calls, and advanced screen sharing without central database storage.

---

## ⚡ Core Features

- 🔐 **Zero-Knowledge Passbox Authentication:** Establish isolated conversation tunnels using ephemeral 6-digit alphanumeric passbox codes or instantaneous QR pairing tokens.
- 🛡️ **Cryptographic Verification:** Deterministic AES-256-GCM session channels backed by Short Authentication String (SAS) fingerprint blocks (`ECDH-P256` + `PBKDF2-SHA256`).
- 📁 **Unlimited P2P File & Media Streaming:** Bypasses browser memory and cloud payload limits via 64 KB binary slicing over WebRTC `RTCDataChannel` with backpressure control.
- 📞 **Encrypted Voice & Video Calling:** Native WebRTC peer media pipeline with acoustic noise suppression and a floating picture-in-picture viewport.
- 🖥️ **Display & System Audio Sharing:** High-resolution screen capture supporting monitor, application window, and display audio streaming.
- 👾 **GIPHY Engine Integration:** In-chat GIF selector with debounced search and live trending feeds powered by the GIPHY API.
- 🎭 **3D AR Avatar Studio:** Interactive 3D avatar customizer supporting real-time expressions, poses, headgear, and custom cyber visors.
- 📡 **Offline Outbox & Zero-Trust Packet Inspector:** Compose messages offline with automated delta sync upon reconnect and inspect raw IVs, salts, and SHA-256 integrity digests in real time.

---

## 🛠️ Tech Stack

- **Framework:** React 18, TypeScript, Vite
- **Styling:** Tailwind CSS, Lucide Icons
- **Real-Time & P2P:** WebRTC (`RTCPeerConnection`, `RTCDataChannel`)
- **Cryptography:** Web Crypto API (`AES-256-GCM`, `ECDH-P256`, `PBKDF2`, `SHA-256`)
- **3D Graphics:** WebGL, Three.js
- **Integrations:** GIPHY API

---

## 🚀 Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) (version 18 or higher) installed.

### 1. Clone the Repository

```bash
git clone [https://github.com/sunitasutar5819-glitch/CipherLink.git](https://github.com/sunitasutar5819-glitch/CipherLink.git)
cd CipherLink
