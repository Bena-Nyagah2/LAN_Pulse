import sqlite3
import time
import uuid
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'lan_pulse.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
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

    # Rooms table
    c.execute('''CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT, -- 'private' or 'group'
        created_at REAL,
        last_message_at REAL
    )''')

    # Room Members table
    # Check if exists to migrate
    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='room_members'")
    if c.fetchone():
        c.execute("PRAGMA table_info(room_members)")
        columns = [info[1] for info in c.fetchall()]
        if 'last_read_at' not in columns:
            c.execute("ALTER TABLE room_members ADD COLUMN last_read_at REAL DEFAULT 0")
        if 'is_pinned' not in columns:
            c.execute("ALTER TABLE room_members ADD COLUMN is_pinned INTEGER DEFAULT 0")
        if 'is_archived' not in columns:
            c.execute("ALTER TABLE room_members ADD COLUMN is_archived INTEGER DEFAULT 0")
    else:
        c.execute('''CREATE TABLE IF NOT EXISTS room_members (
            room_id TEXT,
            user_id TEXT,
            joined_at REAL,
            is_admin INTEGER DEFAULT 0,
            last_read_at REAL DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            is_archived INTEGER DEFAULT 0,
            PRIMARY KEY (room_id, user_id)
        )''')

    # Messages table
    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
    if c.fetchone():
        c.execute("PRAGMA table_info(messages)")
        columns = [info[1] for info in c.fetchall()]
        if 'room_id' not in columns:
            c.execute("ALTER TABLE messages ADD COLUMN room_id TEXT")
    else:
        c.execute('''CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            username TEXT,
            user_color TEXT,
            content TEXT,
            timestamp REAL,
            type TEXT DEFAULT 'text',
            file_id TEXT,
            room_id TEXT
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

# Room operations
def create_room(name, room_type='group'):
    room_id = str(uuid.uuid4())
    conn = get_db()
    c = conn.cursor()
    timestamp = time.time()
    c.execute("INSERT INTO rooms (id, name, type, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)",
              (room_id, name, room_type, timestamp, timestamp))
    conn.commit()
    conn.close()
    return room_id

def get_room(room_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM rooms WHERE id = ?", (room_id,))
    room = c.fetchone()
    conn.close()
    return dict(room) if room else None

def add_room_member(room_id, user_id, is_admin=0):
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute("INSERT INTO room_members (room_id, user_id, joined_at, is_admin, last_read_at) VALUES (?, ?, ?, ?, ?)",
                  (room_id, user_id, time.time(), is_admin, time.time()))
        conn.commit()
    except sqlite3.IntegrityError:
        pass # Already a member
    conn.close()

def get_room_members(room_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT users.* FROM room_members JOIN users ON room_members.user_id = users.id WHERE room_id = ?", (room_id,))
    users = [dict(row) for row in c.fetchall()]
    conn.close()
    return users

def get_user_rooms(user_id):
    conn = get_db()
    c = conn.cursor()
    # Get all rooms the user is in, ordered by is_pinned DESC, last_message_at DESC
    # Also select member specific fields
    c.execute("""
        SELECT rooms.*, rm.last_read_at, rm.is_pinned, rm.is_archived
        FROM rooms
        JOIN room_members rm ON rooms.id = rm.room_id
        WHERE rm.user_id = ?
        ORDER BY rm.is_pinned DESC, rooms.last_message_at DESC
    """, (user_id,))
    rooms = [dict(row) for row in c.fetchall()]

    # For each room, get the last message and unread count
    for room in rooms:
        c.execute("SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 1", (room['id'],))
        last_msg = c.fetchone()
        if last_msg:
            room['last_message'] = dict(last_msg)
        else:
            room['last_message'] = None

        # Unread Count
        c.execute("SELECT COUNT(*) FROM messages WHERE room_id = ? AND timestamp > ?", (room['id'], room['last_read_at']))
        room['unread_count'] = c.fetchone()[0]

        # If private, get the other user's name/avatar
        if room['type'] == 'private':
            c.execute("""
                SELECT users.name, users.color, users.status
                FROM room_members
                JOIN users ON room_members.user_id = users.id
                WHERE room_id = ? AND user_id != ?
            """, (room['id'], user_id))
            other_user = c.fetchone()
            if other_user:
                room['name'] = other_user['name']
                room['other_user_color'] = other_user['color']
                room['other_user_status'] = other_user['status']

    conn.close()
    return rooms

def find_private_room(user_id_1, user_id_2):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT r.id FROM rooms r
        JOIN room_members rm1 ON r.id = rm1.room_id
        JOIN room_members rm2 ON r.id = rm2.room_id
        WHERE r.type = 'private' AND rm1.user_id = ? AND rm2.user_id = ?
    """, (user_id_1, user_id_2))
    row = c.fetchone()
    conn.close()
    return row['id'] if row else None

def mark_room_read(user_id, room_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE room_members SET last_read_at = ? WHERE user_id = ? AND room_id = ?",
              (time.time(), user_id, room_id))
    conn.commit()
    conn.close()

def toggle_pin(user_id, room_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE room_members SET is_pinned = NOT is_pinned WHERE user_id = ? AND room_id = ?",
              (user_id, room_id))
    conn.commit()
    conn.close()

def toggle_archive(user_id, room_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE room_members SET is_archived = NOT is_archived WHERE user_id = ? AND room_id = ?",
              (user_id, room_id))
    conn.commit()
    conn.close()

# Message operations
def add_message(user_id, username, user_color, content, msg_type='text', file_id=None, room_id=None):
    conn = get_db()
    c = conn.cursor()
    timestamp = time.time()
    c.execute("INSERT INTO messages (user_id, username, user_color, content, timestamp, type, file_id, room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              (user_id, username, user_color, content, timestamp, msg_type, file_id, room_id))
    msg_id = c.lastrowid

    # Update room last_message_at
    if room_id:
        c.execute("UPDATE rooms SET last_message_at = ? WHERE id = ?", (timestamp, room_id))

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
        'room_id': room_id,
        'reactions': []
    }

def get_messages(room_id, limit=50):
    conn = get_db()
    c = conn.cursor()
    if room_id:
        c.execute("SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?", (room_id, limit))
    else:
        c.execute("SELECT * FROM messages WHERE room_id IS NULL ORDER BY id DESC LIMIT ?", (limit,))

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
