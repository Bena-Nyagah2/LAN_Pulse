from flask import Flask, render_template, request, send_file, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
import socket
import database
import random
import os
import uuid
import time
import threading
from werkzeug.utils import secure_filename
import functools
import psutil

app = Flask(__name__)
app.config['SECRET_KEY'] = 'lan_pulse_secret_key'
app.config['UPLOAD_FOLDER'] = 'lan_pulse/temp_files'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max upload
app.config['ADMIN_PASSWORD'] = os.environ.get('ADMIN_PASSWORD', 'admin')

# Use threading mode to avoid C-extension build errors on Windows (greenlet/eventlet)
socketio = SocketIO(app, async_mode='threading', cors_allowed_origins='*')

# Ensure upload folder exists
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Initialize DB
database.init_db()

# In-memory mapping of SID to User ID for quick lookup
connected_users = {}

# In-memory Whiteboard History
whiteboard_history = []

START_TIME = time.time()

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# Cleanup Task
def cleanup_files():
    while True:
        time.sleep(3600)  # Check every hour
        deleted_count = database.delete_old_files(86400) # Delete files older than 24h
        if deleted_count > 0:
            print(f"Cleaned up {deleted_count} old files")

# Start background thread
cleanup_thread = threading.Thread(target=cleanup_files, daemon=True)
cleanup_thread.start()

# Auth Decorator
def login_required(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if 'admin_logged_in' not in session:
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    return render_template('index.html', local_ip=get_local_ip())

@app.route('/health')
def health():
    return {"status": "ok"}, 200

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        password = request.form.get('password')
        if password == app.config['ADMIN_PASSWORD']:
            session['admin_logged_in'] = True
            return redirect(url_for('admin_dashboard'))
        else:
            return render_template('login.html', error="Invalid password")
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('admin_logged_in', None)
    return redirect(url_for('index'))

@app.route('/admin')
@login_required
def admin_dashboard():
    users = database.get_all_users()
    files = database.get_all_files()
    clipboard_entries = database.get_clipboard_entries(limit=100)

    # Stats
    stats = {
        'uptime': int(time.time() - START_TIME),
        'active_users': len(connected_users),
        'memory_usage': psutil.virtual_memory().percent,
        'active_files': len(files)
    }

    return render_template('admin.html', users=users, files=files, clipboard_entries=clipboard_entries, stats=stats)

@app.route('/admin/delete_file/<file_id>')
@login_required
def delete_file_route(file_id):
    database.delete_file(file_id)
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/delete_clipboard/<entry_id>')
@login_required
def delete_clipboard_route(entry_id):
    database.delete_clipboard_entry(entry_id)
    return redirect(url_for('admin_dashboard'))

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    user_id = request.form.get('user_id')

    filename = secure_filename(file.filename)
    unique_filename = f"{uuid.uuid4()}_{filename}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
    file.save(filepath)

    # Store metadata
    file_id = database.add_file(filename, filepath, file.mimetype, os.path.getsize(filepath), user_id)

    return jsonify({
        'file_id': file_id,
        'filename': filename,
        'file_type': file.mimetype,
        'size': os.path.getsize(filepath)
    })

@app.route('/upload_audio', methods=['POST'])
def upload_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio part'}), 400
    file = request.files['audio']

    user_id = request.form.get('user_id')
    duration = request.form.get('duration')

    filename = f"voice_note_{int(time.time())}.webm"
    unique_filename = f"{uuid.uuid4()}_{filename}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
    file.save(filepath)

    file_id = database.add_file(filename, filepath, 'audio/webm', os.path.getsize(filepath), user_id)

    return jsonify({
        'file_id': file_id,
        'filename': filename,
        'duration': duration
    })

@app.route('/file/<file_id>')
def serve_file(file_id):
    file_data = database.get_file(file_id)
    if not file_data or not os.path.exists(file_data['filepath']):
        return "File not found", 404

    return send_file(os.path.abspath(file_data['filepath']),
                     as_attachment=True,
                     download_name=file_data['filename'],
                     mimetype=file_data['file_type'])

# Socket.IO Events

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")

@socketio.on('join')
def handle_join(data):
    user_id = data.get('user_id')
    user = None

    if user_id:
        user = database.get_user(user_id)

    if not user:
        # Create new user
        name = f"User{random.randint(1000, 9999)}"
        color = "#{:06x}".format(random.randint(0, 0xFFFFFF))
        user_id = database.create_user(name, color)
        user = {'id': user_id, 'name': name, 'color': color}

    # Store SID mapping
    connected_users[request.sid] = user_id

    # Join user-specific room for notifications
    join_room(user_id)

    # Send user info back to client
    emit('user_info', user)

    # Send clipboard history (Global)
    clipboard = database.get_clipboard_entries(limit=50)
    emit('clipboard_history', clipboard)

    # Send whiteboard history (Global)
    emit('whiteboard_history', whiteboard_history)

    # Join all chat rooms
    rooms = database.get_user_rooms(user_id)
    for room in rooms:
        join_room(room['id'])

    # Emit room list
    emit('room_list', rooms)

    # Update online status
    database.update_user_status(user_id, 'online')

    # Broadcast global user list (for "Start Chat" modal)
    emit('global_user_list', database.get_all_users(), broadcast=True)

@socketio.on('enter_room')
def handle_enter_room(data):
    user_id = connected_users.get(request.sid)
    if not user_id: return

    room_id = data.get('room_id')

    # Mark read
    database.mark_room_read(user_id, room_id)

    # Send history
    history = database.get_messages(room_id=room_id, limit=50)
    emit('message_history', {'room_id': room_id, 'messages': history})

@socketio.on('mark_read')
def handle_mark_read(data):
    user_id = connected_users.get(request.sid)
    if not user_id: return
    room_id = data.get('room_id')
    if room_id:
        database.mark_room_read(user_id, room_id)
        # Notify user's other sessions to update badges
        emit('room_read', {'room_id': room_id}, room=user_id)
        # Broadcast read receipt to room so senders know this user read up to now
        emit('read_receipt', {'room_id': room_id, 'user_id': user_id, 'timestamp': time.time()}, room=room_id, include_self=False)

@socketio.on('toggle_pin')
def handle_toggle_pin(data):
    user_id = connected_users.get(request.sid)
    if not user_id: return
    room_id = data.get('room_id')
    if room_id:
        database.toggle_pin(user_id, room_id)
        # Refresh room list
        rooms = database.get_user_rooms(user_id)
        emit('room_list', rooms)

@socketio.on('toggle_archive')
def handle_toggle_archive(data):
    user_id = connected_users.get(request.sid)
    if not user_id: return
    room_id = data.get('room_id')
    if room_id:
        database.toggle_archive(user_id, room_id)
        # Refresh room list
        rooms = database.get_user_rooms(user_id)
        emit('room_list', rooms)

@socketio.on('create_private_chat')
def handle_create_private(data):
    user_id = connected_users.get(request.sid)
    if not user_id: return

    target_user_id = data.get('target_user_id')
    if not target_user_id: return

    # Check if exists
    room_id = database.find_private_room(user_id, target_user_id)

    if not room_id:
        room_id = database.create_room(name=None, room_type='private')
        database.add_room_member(room_id, user_id)
        database.add_room_member(room_id, target_user_id)

    # Join both users to the room if they are online
    join_room(room_id) # Join current user

    # Notify target user to refresh rooms/join
    # We can use their user_id room to tell them to join
    emit('new_room_invite', {'room_id': room_id}, room=target_user_id)

    # Return room info to creator
    room = database.get_room(room_id)

    # Decorate with target user info
    target_user = database.get_user(target_user_id)
    room['name'] = target_user['name']
    room['other_user_color'] = target_user['color']
    room['other_user_status'] = target_user['status']
    room['last_message'] = None

    emit('room_created', room)

@socketio.on('join_new_room')
def handle_join_new_room(data):
    # Called when client receives 'new_room_invite'
    room_id = data.get('room_id')
    join_room(room_id)
    # Emit updated room list
    user_id = connected_users.get(request.sid)
    rooms = database.get_user_rooms(user_id)
    emit('room_list', rooms)

@socketio.on('create_group_chat')
def handle_create_group(data):
    user_id = connected_users.get(request.sid)
    if not user_id: return

    name = data.get('name')
    member_ids = data.get('members', [])

    if not name: return

    room_id = database.create_room(name=name, room_type='group')
    database.add_room_member(room_id, user_id, is_admin=1)
    join_room(room_id)

    for mid in member_ids:
        database.add_room_member(room_id, mid)
        emit('new_room_invite', {'room_id': room_id}, room=mid)

    room = database.get_room(room_id)
    room['last_message'] = None
    emit('room_created', room)

@socketio.on('disconnect')
def handle_disconnect():
    user_id = connected_users.pop(request.sid, None)
    if user_id:
        print(f"User {user_id} disconnected")
        database.update_user_status(user_id, 'offline')
        emit('global_user_list', database.get_all_users(), broadcast=True)

@socketio.on('send_message')
def handle_message(data):
    user_id = connected_users.get(request.sid)
    if not user_id:
        return

    user = database.get_user(user_id)
    if not user:
        return

    if user.get('is_muted'):
        return

    content = data.get('text', '')
    room_id = data.get('room_id')

    if not content or not room_id:
        return

    msg = database.add_message(user_id, user['name'], user['color'], content, room_id=room_id)
    emit('new_message', msg, room=room_id)

@socketio.on('send_file')
def handle_file(data):
    user_id = connected_users.get(request.sid)
    if not user_id:
        return

    user = database.get_user(user_id)
    if not user:
        return

    if user.get('is_muted'): return

    file_id = data.get('file_id')
    filename = data.get('filename')
    file_type = data.get('file_type')
    room_id = data.get('room_id')

    if not room_id: return

    msg_type = 'image' if file_type.startswith('image/') else 'file'
    content = filename

    msg = database.add_message(user_id, user['name'], user['color'], content, msg_type=msg_type, file_id=file_id, room_id=room_id)
    emit('new_message', msg, room=room_id)

@socketio.on('send_voice')
def handle_voice(data):
    user_id = connected_users.get(request.sid)
    if not user_id:
        return

    user = database.get_user(user_id)
    if user.get('is_muted'): return

    file_id = data.get('file_id')
    duration = data.get('duration')
    room_id = data.get('room_id')

    if not room_id: return

    msg = database.add_message(user_id, user['name'], user['color'], str(duration), msg_type='voice', file_id=file_id, room_id=room_id)
    emit('new_message', msg, room=room_id)

@socketio.on('share_clipboard')
def handle_clipboard(data):
    user_id = connected_users.get(request.sid)
    if not user_id:
        return

    user = database.get_user(user_id)
    if user.get('is_muted'): return

    content = data.get('content')

    # Heuristic for code detection
    entry_type = 'text'
    if len(content) > 50 and ('{' in content or 'def ' in content or 'import ' in content or ';' in content):
        entry_type = 'code'

    entry = database.add_clipboard_entry(user_id, user['name'], content, entry_type)
    emit('new_clipboard_entry', entry, broadcast=True)

@socketio.on('update_profile')
def handle_profile_update(data):
    user_id = connected_users.get(request.sid)
    if not user_id:
        return

    name = data.get('name')
    color = data.get('color')

    if name and color:
        name = name[:20]
        database.update_user_profile(user_id, name, color)
        updated_user = database.get_user(user_id)
        emit('user_info', updated_user)
        emit('global_user_list', database.get_all_users(), broadcast=True)

@socketio.on('add_reaction')
def handle_add_reaction(data):
    user_id = connected_users.get(request.sid)
    if not user_id:
        return

    message_id = data.get('message_id')
    emoji = data.get('emoji')
    room_id = data.get('room_id')

    if not room_id: return # Need room_id to broadcast efficiently? Or broadcast to room by looking up message?
    # Optimization: Client sends room_id

    if database.add_reaction(message_id, user_id, emoji):
        emit('reaction_added', {
            'message_id': message_id,
            'user_id': user_id,
            'emoji': emoji
        }, room=room_id)

@socketio.on('remove_reaction')
def handle_remove_reaction(data):
    user_id = connected_users.get(request.sid)
    if not user_id:
        return

    message_id = data.get('message_id')
    emoji = data.get('emoji')
    room_id = data.get('room_id')

    database.remove_reaction(message_id, user_id, emoji)
    emit('reaction_removed', {
        'message_id': message_id,
        'user_id': user_id,
        'emoji': emoji
    }, room=room_id)

@socketio.on('delete_message')
def handle_delete_message(data):
    user_id = connected_users.get(request.sid)
    if not user_id:
        return

    message_id = data.get('message_id')
    room_id = data.get('room_id')

    # We should verify ownership, but database.delete_message doesn't check owner yet.
    # In a real app, get_message(message_id) -> check user_id.
    # For MVP/Simplicity:
    database.delete_message(message_id)
    emit('message_deleted', {'message_id': message_id}, room=room_id)

@socketio.on('draw')
def handle_draw(data):
    whiteboard_history.append(data)
    emit('draw', data, broadcast=True, include_self=False)

@socketio.on('clear_board')
def handle_clear_board():
    global whiteboard_history
    whiteboard_history = []
    emit('clear_board', broadcast=True)

@socketio.on('typing')
def handle_typing(data):
    user_id = connected_users.get(request.sid)
    if user_id:
        user = database.get_user(user_id)
        room_id = data.get('room_id')
        if user and room_id:
            emit('typing', {'username': user['name'], 'room_id': room_id}, room=room_id, include_self=False)

# Admin Socket Events
@socketio.on('admin_kick_user')
def handle_kick_user(data):
    if not session.get('admin_logged_in'):
        return

    target_user_id = data.get('user_id')
    target_sid = None
    for sid, uid in connected_users.items():
        if uid == target_user_id:
            target_sid = sid
            break

    if target_sid:
        emit('kicked', room=target_sid)
        socketio.server.disconnect(target_sid)

@socketio.on('admin_mute_user')
def handle_mute_user(data):
    if not session.get('admin_logged_in'):
        return

    user_id = data.get('user_id')
    database.mute_user(user_id)

@socketio.on('admin_unmute_user')
def handle_unmute_user(data):
    if not session.get('admin_logged_in'):
        return

    user_id = data.get('user_id')
    database.unmute_user(user_id)

@socketio.on('admin_broadcast')
def handle_broadcast(data):
    if not session.get('admin_logged_in'):
        return

    message = data.get('message')
    # Broadcast to ALL rooms/users? "broadcast=True" sends to all connected clients regardless of room
    emit('new_message', {
        'id': 0,
        'user_id': 'admin',
        'username': 'SYSTEM',
        'user_color': '#ff0000',
        'content': message,
        'timestamp': time.time(),
        'type': 'text',
        'reactions': [],
        'room_id': 'GLOBAL' # Special ID for broadcast
    }, broadcast=True)

if __name__ == '__main__':
    local_ip = get_local_ip()
    print(f" * LAN Pulse server running at http://{local_ip}:5000")
    print(f" * Admin Password: {app.config['ADMIN_PASSWORD']}")
    # Allow unsafe werkzeug for local/development use as per requirements
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
