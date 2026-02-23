# LAN Pulse

**LAN Pulse** is a lightweight, self-contained web application designed for local networks. It features real-time chat, file sharing, voice notes, a shared clipboard, and a collaborative whiteboard. It is optimized for low-spec hardware (1GB RAM) and works completely offline.

## Features

*   **Real-time Chat:** Text, emojis, file uploads, and voice notes.
*   **Shared Clipboard:** Sync text and code snippets across devices instantly.
*   **Collaborative Whiteboard:** Draw together in real-time.
*   **Admin Dashboard:** Monitor stats, kick/mute users, and manage files.
*   **Offline Resilience:** PWA support with offline caching and message queuing.
*   **Modern UI:** Dark/Light mode, animations, and responsive design.

## Requirements

*   Python 3.8+
*   Windows, Linux, or macOS

## Installation

1.  **Clone or Download** this repository.
2.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
    *Note: `eventlet` is NOT required to avoid build issues on Windows. The app uses standard threading.*

## Running the Server

1.  Navigate to the project directory:
    ```bash
    cd lan_pulse
    ```

2.  Run the application:
    ```bash
    python app.py
    ```

3.  The server will start and print the local IP address (e.g., `http://192.168.1.5:5000`).

## Usage

*   **Join:** Open the printed URL on any device connected to the same Wi-Fi.
*   **Admin:** Go to `/login` (default password: `admin`).
    *   To change the password, set the `ADMIN_PASSWORD` environment variable before running.

## Project Structure

*   `app.py`: Main Flask application server.
*   `database.py`: SQLite database operations.
*   `templates/`: HTML templates.
*   `static/`: CSS, JS, and vendor libraries (served locally).
*   `temp_files/`: Storage for uploaded files.

## Troubleshooting

*   **Firewall:** If other devices cannot connect, ensure your firewall allows traffic on port 5000.
*   **Offline Mode:** If the server stops, the app will continue to show history and queue new messages until reconnection.
