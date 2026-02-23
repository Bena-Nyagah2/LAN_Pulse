import sqlite3
import time
import uuid
import os

DB_PATH = 'lan_pulse/lan_pulse.db'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if not os.path.exists('lan_pulse'):
        os.makedirs('lan_pulse')

    conn = get_db()
    c = conn.cursor()

    # Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        color TEXT,
        status TEXT DEFAULT 'online',
        last_seen REAL,
        is_muted INTEGER DEFAULT 0
    )''')

    # Messages table
    c.execute('''CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        username TEXT,
        user_color TEXT,
        content TEXT,
        timestamp REAL,
        type TEXT DEFAULT 'text',
        file_id TEXT
    )''')

    # Files table
    c.execute('''CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        filename TEXT,
        filepath TEXT,
        file_type TEXT,
        size INTEGER,
        uploader_id TEXT,
        timestamp REAL
    )''')

    # Clipboard table
    c.execute('''CREATE TABLE IF NOT EXISTS clipboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        username TEXT,
        content TEXT,
        timestamp REAL,
        type TEXT DEFAULT 'text'
    )''')

    # Reactions table
    c.execute('''CREATE TABLE IF NOT EXISTS reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER,
        user_id TEXT,
        emoji TEXT,
        timestamp REAL,
        UNIQUE(message_id, user_id, emoji)
    )''')

    conn.commit()
    conn.close()

# User operations
def create_user(name, color):
    user_id = str(uuid.uuid4())
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO users (id, name, color, last_seen) VALUES (?, ?, ?, ?)",
              (user_id, name, color, time.time()))
    conn.commit()
    conn.close()
    return user_id

def get_user(user_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()
    conn.close()
    return dict(user) if user else None

def update_user_status(user_id, status):
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE users SET status = ?, last_seen = ? WHERE id = ?",
              (status, time.time(), user_id))
    conn.commit()
    conn.close()

def update_user_profile(user_id, name, color):
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE users SET name = ?, color = ? WHERE id = ?",
              (name, color, user_id))
    conn.commit()
    conn.close()

def get_all_users():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users")
    users = [dict(row) for row in c.fetchall()]
    conn.close()
    return users

def mute_user(user_id):
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute("UPDATE users SET is_muted = 1 WHERE id = ?", (user_id,))
        conn.commit()
    except Exception:
        pass
    conn.close()

def unmute_user(user_id):
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute("UPDATE users SET is_muted = 0 WHERE id = ?", (user_id,))
        conn.commit()
    except Exception:
        pass
    conn.close()

# Message operations
def add_message(user_id, username, user_color, content, msg_type='text', file_id=None):
    conn = get_db()
    c = conn.cursor()
    timestamp = time.time()
    c.execute("INSERT INTO messages (user_id, username, user_color, content, timestamp, type, file_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
              (user_id, username, user_color, content, timestamp, msg_type, file_id))
    msg_id = c.lastrowid
    conn.commit()
    conn.close()
    return {
        'id': msg_id,
        'user_id': user_id,
        'username': username,
        'user_color': user_color,
        'content': content,
        'timestamp': timestamp,
        'type': msg_type,
        'file_id': file_id,
        'reactions': []
    }

def get_messages(limit=100):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM messages ORDER BY id DESC LIMIT ?", (limit,))
    messages = [dict(row) for row in c.fetchall()]

    msg_ids = [m['id'] for m in messages]
    if msg_ids:
        placeholders = ','.join(['?']*len(msg_ids))
        c.execute(f"SELECT * FROM reactions WHERE message_id IN ({placeholders})", msg_ids)
        reactions = [dict(row) for row in c.fetchall()]

        from collections import defaultdict
        reactions_map = defaultdict(list)
        for r in reactions:
            reactions_map[r['message_id']].append(r)

        for m in messages:
            m['reactions'] = reactions_map[m['id']]

    conn.close()
    return messages[::-1]

def delete_message(message_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM messages WHERE id = ?", (message_id,))
    c.execute("DELETE FROM reactions WHERE message_id = ?", (message_id,))
    conn.commit()
    conn.close()

# File operations
def add_file(filename, filepath, file_type, size, uploader_id):
    file_id = str(uuid.uuid4())
    conn = get_db()
    c = conn.cursor()
    timestamp = time.time()
    c.execute("INSERT INTO files (id, filename, filepath, file_type, size, uploader_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
              (file_id, filename, filepath, file_type, size, uploader_id, timestamp))
    conn.commit()
    conn.close()
    return file_id

def get_file(file_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM files WHERE id = ?", (file_id,))
    file_data = c.fetchone()
    conn.close()
    return dict(file_data) if file_data else None

def get_all_files():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM files ORDER BY timestamp DESC")
    files = [dict(row) for row in c.fetchall()]
    conn.close()
    return files

def delete_file(file_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT filepath FROM files WHERE id = ?", (file_id,))
    row = c.fetchone()
    if row and os.path.exists(row['filepath']):
        try:
            os.remove(row['filepath'])
        except OSError:
            pass

    c.execute("DELETE FROM files WHERE id = ?", (file_id,))
    conn.commit()
    conn.close()

def delete_old_files(age_seconds):
    conn = get_db()
    c = conn.cursor()
    cutoff = time.time() - age_seconds
    c.execute("SELECT * FROM files WHERE timestamp < ?", (cutoff,))
    old_files = [dict(row) for row in c.fetchall()]

    deleted_ids = []
    for f in old_files:
        if os.path.exists(f['filepath']):
            try:
                os.remove(f['filepath'])
            except OSError:
                pass
        deleted_ids.append(f['id'])

    if deleted_ids:
        c.execute(f"DELETE FROM files WHERE id IN ({','.join(['?']*len(deleted_ids))})", deleted_ids)
        conn.commit()

    conn.close()
    return len(deleted_ids)

# Clipboard operations
def add_clipboard_entry(user_id, username, content, entry_type='text'):
    conn = get_db()
    c = conn.cursor()
    timestamp = time.time()
    c.execute("INSERT INTO clipboard (user_id, username, content, timestamp, type) VALUES (?, ?, ?, ?, ?)",
              (user_id, username, content, timestamp, entry_type))
    entry_id = c.lastrowid
    conn.commit()
    conn.close()
    return {
        'id': entry_id,
        'user_id': user_id,
        'username': username,
        'content': content,
        'timestamp': timestamp,
        'type': entry_type
    }

def get_clipboard_entries(limit=50):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM clipboard ORDER BY id DESC LIMIT ?", (limit,))
    entries = [dict(row) for row in c.fetchall()]
    conn.close()
    return entries

def delete_clipboard_entry(entry_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM clipboard WHERE id = ?", (entry_id,))
    conn.commit()
    conn.close()

# Reaction operations
def add_reaction(message_id, user_id, emoji):
    conn = get_db()
    c = conn.cursor()
    timestamp = time.time()
    try:
        c.execute("INSERT INTO reactions (message_id, user_id, emoji, timestamp) VALUES (?, ?, ?, ?)",
                  (message_id, user_id, emoji, timestamp))
        conn.commit()
        success = True
    except sqlite3.IntegrityError:
        success = False
    conn.close()
    return success

def remove_reaction(message_id, user_id, emoji):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
              (message_id, user_id, emoji))
    conn.commit()
    conn.close()

def get_reactions(message_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM reactions WHERE message_id = ?", (message_id,))
    reactions = [dict(row) for row in c.fetchall()]
    conn.close()
    return reactions
