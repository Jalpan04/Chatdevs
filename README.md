# Cardamom Group Chat

A simple, single-file, terminal-themed group chat application built with Node.js, Express, and Socket.io. Create temporary, time-limited chat rooms for quick conversations with friends.

![A screenshot of the Cardamom chat interface, showing the CLI theme, a list of users, and the main chat log.](https://github.com/user-attachments/assets/ea8a0706-6eb0-4bdb-a3a0-0d9855081c55)

**Live Demo:** [https://chatdevs.onrender.com/](https://chatdevs.onrender.com/)

## Features

* **Private Rooms:** Create private chat rooms with a generated, easy-to-share 6-character code.
* **Room Configuration:** Set room options for max users and a time limit (in minutes).
* **Leader-Controlled:** A "leader" (the room creator) controls when the chat session starts.
* **Time-Limited Chats:** The session automatically ends for all users when the server-side timer hits zero.
* **CLI-Style UI:** A fun, retro terminal-style interface built with plain HTML, CSS, and JavaScript.
* **User-Specific Colors:** Each user is automatically assigned a unique, high-contrast color to easily distinguish messages.
* **"Copy Code" Button:** Quickly copy the room code to your clipboard for easy sharing.
* **Real-time Updates:** See a live list of users in the room.
* **Graceful Handling:** The server correctly handles user disconnects. If the leader leaves, a new leader is automatically assigned.

## Technology Stack

* **Backend:** Node.js, Express (for serving the client), Socket.io (for WebSocket communication)
* **Frontend:** Vanilla HTML, CSS, and JavaScript (no frameworks)
* **Architecture:** A single-file application where the Node.js server embeds and serves the entire client-side app.

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine.

### Prerequisites

You must have Node.js (which includes npm) installed on your system.

### Installation

1. **Clone the repository** (or just save the file):

   If you have this in a repository:
   ```bash
   git clone https://github.com/your-username/your-repo-name.git
   cd your-repo-name
   ```

   If you just have the single file, save it as `index.js` in a new folder and open your terminal in that folder.

2. **Install dependencies:**

   The project requires `express` and `socket.io`.
   ```bash
   npm install express socket.io
   ```

## Running the Application

1. **Start the server:**
   ```bash
   node index.js
   ```

2. **Open the application:**

   Open your web browser and navigate to `http://localhost:3000`.

## How to Use

### User 1 (The Leader):
* Opens `http://localhost:3000`.
* Enters a username (e.g., "Leader").
* (Optional) Adjusts the "max users" and "time limit" fields.
* Clicks **CREATE**.
* Clicks **COPY CODE** to get the room code (e.g., `A4B9D2`).

### User 2 (A Friend):
* Opens `http://localhost:3000` in a separate browser tab or on a different computer.
* Enters their username (e.g., "Friend").
* Pastes the room code `A4B9D2` into the room code box.
* Clicks **JOIN**.

### The Leader:
* Sees "Friend" appear in the users list.
* Clicks **START CHAT** when everyone is ready.

### All Users:
* The chat log becomes active, and the countdown timer begins.
* Everyone can now send and receive messages in real-time.
* When the timer runs out, the chat will end, and the room will be closed.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
