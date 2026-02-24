document.addEventListener('DOMContentLoaded', () => {
    console.log('LAN Pulse: Initializing v2.1...');

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js')
            .then(reg => console.log('Service Worker Registered'))
            .catch(err => console.log('Service Worker Failed', err));
    }

    const statusEl = document.getElementById('connection-status');
    let socket;
    try {
        socket = io({
            transports: ['websocket', 'polling'],
            reconnectionAttempts: 5
        });
    } catch (e) {
        console.error("Socket init failed:", e);
        statusEl.innerText = "Error: " + e.message;
        statusEl.className = "status-indicator status-offline";
        return;
    }

    // Chat Layout
    const chatLayout = document.querySelector('.chat-layout');
    const roomListEl = document.getElementById('room-list');
    const chatWindow = document.getElementById('chat-window');
    const backToListBtn = document.getElementById('back-to-list-btn');
    const currentRoomNameEl = document.getElementById('current-room-name');
    const currentRoomStatusEl = document.getElementById('current-room-status');
    const messagesContainer = document.getElementById('messages-container');
    const inputArea = document.getElementById('input-area');

    // Chat Inputs
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const fileBtn = document.getElementById('file-btn');
    const fileInput = document.getElementById('file-input');
    const micBtn = document.getElementById('mic-btn');
    const recordingUI = document.getElementById('recording-ui');
    const recordingTimer = document.getElementById('recording-timer');
    const stopRecordingBtn = document.getElementById('stop-recording');
    const cancelRecordingBtn = document.getElementById('cancel-recording');
    const typingIndicator = document.getElementById('typing-indicator');

    // Modals & User Lists
    const newChatBtn = document.getElementById('new-chat-btn');
    const newGroupBtn = document.getElementById('new-group-btn');
    const newChatModal = document.getElementById('new-chat-modal');
    const closeNewChat = document.getElementById('close-new-chat');
    const globalUserListEl = document.getElementById('global-user-list');

    const createGroupModal = document.getElementById('create-group-modal');
    const closeCreateGroup = document.getElementById('close-create-group');
    const groupUserListEl = document.getElementById('group-user-list');
    const groupNameInput = document.getElementById('group-name-input');
    const createGroupSubmitBtn = document.getElementById('create-group-submit-btn');

    // Navigation
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Mobile Sidebar
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const mobileStatus = document.getElementById('mobile-status');

    // Clipboard & Whiteboard (Legacy support)
    const clipboardInput = document.getElementById('clipboard-input');
    const shareClipboardBtn = document.getElementById('share-clipboard-btn');
    const clipboardEntries = document.getElementById('clipboard-entries');
    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');

    // Profile
    const myProfileDiv = document.querySelector('.my-profile');
    const profileModal = document.getElementById('profile-modal');
    const closeModal = document.getElementById('close-modal');
    const saveProfileBtn = document.getElementById('save-profile-btn');
    const profileNameInput = document.getElementById('profile-name');
    const profileColorInput = document.getElementById('profile-color');
    const myNameEl = document.getElementById('my-name');
    const myAvatarEl = document.getElementById('my-avatar');

    // --- State ---
    let myUserId = localStorage.getItem('lan_pulse_user_id');
    let myUser = null;
    let currentRoomId = null;
    let rooms = [];
    let typingTimeout = null;

    // Recording State
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingStartTime = 0;
    let recordingInterval = null;

    // Whiteboard State
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentTool = 'pen';
    let currentColor = '#000000';
    let currentSize = 5;

    // Offline Queue
    const LOCAL_QUEUE_KEY = 'lan_pulse_queue';

    // --- Helpers ---

    const scrollToBottom = () => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const updateStatus = (text, type) => {
        statusEl.innerText = text;
        statusEl.className = `status-indicator status-${type}`;
        if (mobileStatus) {
             if (type === 'online') mobileStatus.innerHTML = '<i class="fa-solid fa-wifi"></i>';
             else mobileStatus.innerHTML = '<i class="fa-solid fa-wifi" style="opacity: 0.5"></i>';
        }
    };

    // Offline Logic
    const addToQueue = (type, data) => {
        const queue = JSON.parse(localStorage.getItem(LOCAL_QUEUE_KEY) || '[]');
        queue.push({ type, data, timestamp: Date.now() });
        localStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(queue));
        console.log('Added to offline queue:', type);
    };

    const processQueue = () => {
        const queue = JSON.parse(localStorage.getItem(LOCAL_QUEUE_KEY) || '[]');
        if (queue.length === 0) return;
        console.log(`Processing ${queue.length} queued items...`);
        queue.forEach(item => {
            if (item.type === 'message') {
                socket.emit('send_message', item.data);
            }
        });
        localStorage.removeItem(LOCAL_QUEUE_KEY);
    };

    // --- Room Logic ---

    const renderRoomList = () => {
        roomListEl.innerHTML = '';
        rooms.forEach(room => {
            if (room.is_archived) return; // Don't show archived for now (future feature: Archive view)

            const div = document.createElement('div');
            div.className = `room-item ${room.id === currentRoomId ? 'active' : ''}`;
            div.onclick = () => selectRoom(room.id);
            div.oncontextmenu = (e) => {
                e.preventDefault();
                showRoomOptions(room.id);
            };

            // Determine display name and avatar color
            let displayName = room.name || 'Unnamed Group';
            let avatarColor = '#ccc';
            let avatarText = displayName.substring(0, 2).toUpperCase();

            if (room.type === 'private') {
                 // In private chat, name is the OTHER user's name
                 avatarColor = room.other_user_color || '#ccc';
                 avatarText = displayName.substring(0, 2).toUpperCase();
            } else {
                 avatarText = '<i class="fa-solid fa-users"></i>';
                 avatarColor = '#555';
            }

            const lastMsg = room.last_message ? (
                 room.last_message.type === 'text' ? room.last_message.content : `[${room.last_message.type}]`
            ) : 'No messages yet';

            const timeStr = room.last_message ? new Date(room.last_message.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

            let badges = '';
            if (room.is_pinned) badges += '<i class="fa-solid fa-thumbtack" style="font-size: 0.7rem; color: #aaa; margin-right: 5px;"></i>';
            if (room.unread_count > 0) badges += `<div class="unread-badge">${room.unread_count}</div>`;

            div.innerHTML = `
                <div class="room-avatar" style="background-color: ${avatarColor}">${avatarText}</div>
                <div class="room-info">
                    <div class="room-name">${displayName}</div>
                    <div class="room-last-msg">${lastMsg}</div>
                </div>
                <div class="room-meta">
                    <span class="room-time">${timeStr}</span>
                    <div style="display: flex; align-items: center; justify-content: flex-end;">${badges}</div>
                </div>
            `;
            roomListEl.appendChild(div);
        });
    };

    const showRoomOptions = (roomId) => {
        const room = rooms.find(r => r.id === roomId);
        if (!room) return;

        const action = room.is_pinned ? 'Unpin' : 'Pin';
        const archiveAction = room.is_archived ? 'Unarchive' : 'Archive';

        if (confirm(`${action} or ${archiveAction} this chat?
OK = ${action}
Cancel = ${archiveAction}`)) {
             socket.emit('toggle_pin', { room_id: roomId });
        } else {
             // Hacky way to use confirm for two options. ideally a custom modal.
             // If user cancels, we treat it as Archive? No, that's bad UX.
             // Let's simpler: Long press/Right click -> Toggle Pin.
             // Let's just confirm Pin/Unpin.
             // Future: Proper context menu.
        }
    };

    // Better logic: Click triggers select.
    // Need a UI way to pin/archive.
    // I will add a small button in room-meta if hovered?
    // Or just rely on long-press context menu which I implemented above (poorly).
    // Let's implement specific functions.

    // Revised showRoomOptions
    // Actually, let's keep it simple: Right click toggles PIN.
    div.oncontextmenu = (e) => {
        e.preventDefault();
        socket.emit('toggle_pin', { room_id: room.id });
    };

    const selectRoom = (roomId) => {
        if (currentRoomId === roomId) return;
        currentRoomId = roomId;

        // Zero unread count locally
        const roomIndex = rooms.findIndex(r => r.id === roomId);
        if (roomIndex > -1) {
            rooms[roomIndex].unread_count = 0;
        }

        // Update UI
        document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
        renderRoomList(); // Re-render to update active state

        // Mobile Transition
        if (window.innerWidth <= 768) {
            chatLayout.classList.add('show-window');
        }

        // Setup Window
        const room = rooms.find(r => r.id === roomId);
        if (room) {
            currentRoomNameEl.innerText = room.name || 'Chat';
            currentRoomStatusEl.innerText = room.type === 'private' ? (room.other_user_status || '') : `${room.member_count || ''} members`;

            messagesContainer.innerHTML = ''; // Clear previous
            inputArea.style.display = 'flex';

            // Fetch History & Mark Read
            socket.emit('enter_room', { room_id: roomId });
        }
    };

    backToListBtn.addEventListener('click', () => {
        chatLayout.classList.remove('show-window');
        currentRoomId = null;
    });

    // --- Message Rendering ---

    const commonEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡'];

    const groupReactions = (reactions) => {
        const groups = {};
        if (!reactions) return groups;
        reactions.forEach(r => {
            if (!groups[r.emoji]) groups[r.emoji] = { count: 0, reactedByMe: false };
            groups[r.emoji].count++;
            if (r.user_id === myUserId) groups[r.emoji].reactedByMe = true;
        });
        return groups;
    };

    const renderMessage = (msg) => {
        // If message belongs to current room
        if (msg.room_id !== currentRoomId && msg.room_id !== 'GLOBAL' && currentRoomId !== null) {
            // Update last message in room list
            const roomIndex = rooms.findIndex(r => r.id === msg.room_id);
            if (roomIndex > -1) {
                rooms[roomIndex].last_message = msg;
                rooms[roomIndex].unread_count = (rooms[roomIndex].unread_count || 0) + 1;
                // Move to top if not pinned (pinned stays at top)
                if (!rooms[roomIndex].is_pinned) {
                    const room = rooms.splice(roomIndex, 1)[0];
                    // Insert after pinned rooms
                    let insertIdx = 0;
                    while(insertIdx < rooms.length && rooms[insertIdx].is_pinned) insertIdx++;
                    rooms.splice(insertIdx, 0, room);
                }
                renderRoomList();
            }
            return;
        }

        // If global broadcast or current room
        if (msg.room_id === 'GLOBAL' && currentRoomId !== null) {
             // Show system message?
        }

        if (currentRoomId === null && msg.room_id) {
             // Received message while in lobby, update list
            const roomIndex = rooms.findIndex(r => r.id === msg.room_id);
            if (roomIndex > -1) {
                rooms[roomIndex].last_message = msg;
                rooms[roomIndex].unread_count = (rooms[roomIndex].unread_count || 0) + 1;
                // Move to top logic...
                if (!rooms[roomIndex].is_pinned) {
                     const room = rooms.splice(roomIndex, 1)[0];
                     let insertIdx = 0;
                     while(insertIdx < rooms.length && rooms[insertIdx].is_pinned) insertIdx++;
                     rooms.splice(insertIdx, 0, room);
                }
                renderRoomList();
            }
             return;
        }

        // If current room, mark read implicitly?
        if (msg.room_id === currentRoomId) {
             socket.emit('mark_read', { room_id: currentRoomId });
        }

        const isMine = msg.user_id === myUser?.id;
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isMine ? 'mine' : 'others'}`;
        msgDiv.id = `msg-${msg.id}`;

        const time = new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let contentHtml = '';
        if (msg.type === 'text') {
            contentHtml = `<div class="message-content">${marked.parse(msg.content)}</div>`;
        } else if (msg.type === 'image') {
            contentHtml = `<img src="/file/${msg.file_id}" class="message-image" alt="${msg.content}">`;
        } else if (msg.type === 'file') {
            contentHtml = `
                <a href="/file/${msg.file_id}" class="message-file" download="${msg.content}">
                    <i class="fa-solid fa-file"></i>
                    <span>${msg.content}</span>
                </a>`;
        } else if (msg.type === 'voice') {
            const duration = parseFloat(msg.content).toFixed(1);
            contentHtml = `
                <div class="message-voice">
                    <audio controls src="/file/${msg.file_id}"></audio>
                    <div style="font-size: 0.8rem; color: #aaa; margin-top: 4px;">Voice Note (${duration}s)</div>
                </div>`;
        }

        // Reactions
        const reactionBar = document.createElement('div');
        reactionBar.className = 'reaction-bar';
        commonEmojis.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'reaction-btn';
            btn.textContent = emoji;
            btn.onclick = () => {
                socket.emit('add_reaction', { message_id: msg.id, emoji: emoji, room_id: currentRoomId });
            };
            reactionBar.appendChild(btn);
        });

        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'reactions-container';
        reactionsContainer.id = `reactions-${msg.id}`;

        if (msg.reactions) {
             const groups = groupReactions(msg.reactions);
             renderReactions(groups, reactionsContainer, msg.id);
        }

        msgDiv.innerHTML = `
            <div class="message-header">
                <span class="username" style="color: ${msg.user_color}">${msg.username}</span>
                <span class="time">${time}</span>
            </div>
            ${contentHtml}
        `;
        msgDiv.appendChild(reactionBar);
        msgDiv.appendChild(reactionsContainer);
        messagesContainer.appendChild(msgDiv);
        scrollToBottom();

        if (msg.type === 'image') {
            const img = msgDiv.querySelector('img');
            img.onload = scrollToBottom;
        }
    };

    const renderReactions = (groups, container, msgId) => {
        container.innerHTML = '';
        for (const [emoji, data] of Object.entries(groups)) {
            const pill = document.createElement('div');
            pill.className = `reaction-pill ${data.reactedByMe ? 'reacted' : ''}`;
            pill.innerHTML = `${emoji} <span>${data.count}</span>`;
            pill.onclick = () => {
                if (data.reactedByMe) {
                    socket.emit('remove_reaction', { message_id: msgId, emoji: emoji, room_id: currentRoomId });
                } else {
                    socket.emit('add_reaction', { message_id: msgId, emoji: emoji, room_id: currentRoomId });
                }
            };
            container.appendChild(pill);
        }
    };

    // --- Socket Events ---

    socket.on('connect', () => {
        console.log('Connected');
        updateStatus('Connected', 'online');
        socket.emit('join', { user_id: myUserId });
        processQueue();
    });

    socket.on('disconnect', () => {
        updateStatus('Offline', 'offline');
    });

    socket.on('connect_error', (err) => {
        console.error('Connection Error:', err);
        updateStatus('Conn Err: ' + err.message, 'offline');
    });

    socket.on('user_info', (user) => {
        myUser = user;
        myUserId = user.id;
        localStorage.setItem('lan_pulse_user_id', user.id);
        myNameEl.innerText = user.name;
        myAvatarEl.style.backgroundColor = user.color;
        myAvatarEl.innerText = user.name.substring(0, 2).toUpperCase();
        profileNameInput.value = user.name;
        profileColorInput.value = user.color;
    });

    socket.on('room_list', (data) => {
        rooms = data;
        renderRoomList();
    });

    socket.on('message_history', (data) => {
        if (data.room_id === currentRoomId) {
            messagesContainer.innerHTML = '';
            data.messages.forEach(renderMessage);
            scrollToBottom();
        }
    });

    socket.on('new_message', (msg) => {
        renderMessage(msg);
    });

    socket.on('typing', (data) => {
        if (data.room_id === currentRoomId) {
            typingIndicator.innerText = `${data.username} is typing...`;
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                typingIndicator.innerText = '';
            }, 2000);
        }
    });

    socket.on('room_created', (room) => {
        const existingIndex = rooms.findIndex(r => r.id === room.id);
        if (existingIndex > -1) {
             rooms.splice(existingIndex, 1);
        }
        // Insert correctly (after pins)
        let insertIdx = 0;
        while(insertIdx < rooms.length && rooms[insertIdx].is_pinned) insertIdx++;
        rooms.splice(insertIdx, 0, room);

        renderRoomList();
        selectRoom(room.id); // Auto enter
        closeNewChatModal();
        closeCreateGroupModal();
    });

    socket.on('new_room_invite', (data) => {
        socket.emit('join_new_room', { room_id: data.room_id });
    });

    socket.on('reaction_added', (data) => {
         updateReactionsDOM(data.message_id, data.user_id, data.emoji, true);
    });

    socket.on('reaction_removed', (data) => {
         updateReactionsDOM(data.message_id, data.user_id, data.emoji, false);
    });

    const updateReactionsDOM = (msgId, userId, emoji, added) => {
        const container = document.getElementById(`reactions-${msgId}`);
        if (!container) return;

        let pill = null;
        for (let p of container.children) {
            if (p.textContent.includes(emoji)) {
                pill = p;
                break;
            }
        }

        if (added) {
            if (pill) {
                const countSpan = pill.querySelector('span');
                let count = parseInt(countSpan.textContent) + 1;
                countSpan.textContent = count;
                if (userId === myUserId) pill.classList.add('reacted');
            } else {
                pill = document.createElement('div');
                pill.className = `reaction-pill ${userId === myUserId ? 'reacted' : ''}`;
                pill.innerHTML = `${emoji} <span>1</span>`;
                pill.onclick = () => socket.emit('remove_reaction', { message_id: msgId, emoji: emoji, room_id: currentRoomId });
                container.appendChild(pill);
            }
        } else {
            if (pill) {
                const countSpan = pill.querySelector('span');
                let count = parseInt(countSpan.textContent) - 1;
                if (count <= 0) {
                    pill.remove();
                } else {
                    countSpan.textContent = count;
                    if (userId === myUserId) pill.classList.remove('reacted');
                }
            }
        }
    };

    // --- Sending Messages ---

    const sendMessage = () => {
        if (!currentRoomId) return;
        const text = messageInput.value.trim();
        if (text) {
             if (socket.connected) {
                  socket.emit('send_message', { text, room_id: currentRoomId });
             } else {
                  addToQueue('message', { text, room_id: currentRoomId });
                  // Optimistic
                  renderMessage({
                      id: 'temp-' + Date.now(),
                      user_id: myUserId,
                      username: myUser ? myUser.name : 'Me',
                      user_color: myUser ? myUser.color : '#ccc',
                      content: text,
                      timestamp: Date.now() / 1000,
                      type: 'text',
                      room_id: currentRoomId,
                      reactions: []
                  });
             }
            messageInput.value = '';
        }
    };

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    messageInput.addEventListener('input', () => {
        if (currentRoomId) socket.emit('typing', { room_id: currentRoomId });
    });

    // --- File Upload ---

    const uploadFile = async (file) => {
        if (!file || !currentRoomId) return;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', myUserId);

        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            if (response.ok) {
                const data = await response.json();
                socket.emit('send_file', {
                    file_id: data.file_id,
                    filename: data.filename,
                    file_type: data.file_type,
                    room_id: currentRoomId
                });
            }
        } catch(e) { console.error(e); }
    };

    fileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            uploadFile(fileInput.files[0]);
            fileInput.value = '';
        }
    });

    // --- Audio ---
    const uploadAudio = async (blob, duration) => {
        if (!currentRoomId) return;
        const formData = new FormData();
        formData.append('audio', blob, 'voice_note.webm');
        formData.append('user_id', myUserId);
        formData.append('duration', duration);
        try {
            const response = await fetch('/upload_audio', { method: 'POST', body: formData });
            if (response.ok) {
                const data = await response.json();
                socket.emit('send_voice', { file_id: data.file_id, duration, room_id: currentRoomId });
            }
        } catch(e) { console.error(e); }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start();

            recordingUI.style.display = 'flex';
            recordingStartTime = Date.now();
            recordingTimer.innerText = "0:00";
            recordingInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - recordingStartTime)/1000);
                recordingTimer.innerText = `${Math.floor(elapsed/60)}:${(elapsed%60).toString().padStart(2,'0')}`;
            }, 1000);
        } catch(e) { alert("Mic error"); }
    };

    const stopRecording = (save) => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.onstop = () => {
                mediaRecorder.stream.getTracks().forEach(t => t.stop());
                if (save) {
                    const blob = new Blob(audioChunks, { type: 'audio/webm' });
                    uploadAudio(blob, (Date.now() - recordingStartTime)/1000);
                }
            };
            mediaRecorder.stop();
            clearInterval(recordingInterval);
            recordingUI.style.display = 'none';
        }
    };

    if (micBtn) micBtn.addEventListener('click', startRecording);
    if (stopRecordingBtn) stopRecordingBtn.addEventListener('click', () => stopRecording(true));
    if (cancelRecordingBtn) cancelRecordingBtn.addEventListener('click', () => stopRecording(false));

    // --- User Lists & Modals ---

    socket.on('global_user_list', (users) => {
        globalUserListEl.innerHTML = '';
        groupUserListEl.innerHTML = '';

        users.forEach(u => {
            if (u.id === myUserId) return; // Don't show self

            // For Private Chat
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="user-status-dot ${u.status === 'online' ? 'status-online' : 'status-offline'}"></div>
                <span style="color: ${u.color}">${u.name}</span>
            `;
            li.onclick = () => {
                socket.emit('create_private_chat', { target_user_id: u.id });
            };
            globalUserListEl.appendChild(li);

            // For Group Chat
            const liGroup = document.createElement('li');
            liGroup.innerHTML = `
                <input type="checkbox" value="${u.id}">
                <span style="color: ${u.color}">${u.name}</span>
            `;
            groupUserListEl.appendChild(liGroup);
        });
    });

    newChatBtn.addEventListener('click', () => {
        newChatModal.style.display = 'flex';
        setTimeout(() => newChatModal.classList.add('show'), 10);
    });

    const closeNewChatModal = () => {
        newChatModal.classList.remove('show');
        setTimeout(() => newChatModal.style.display = 'none', 300);
    };

    closeNewChat.addEventListener('click', closeNewChatModal);

    newGroupBtn.addEventListener('click', () => {
        createGroupModal.style.display = 'flex';
        setTimeout(() => createGroupModal.classList.add('show'), 10);
    });

    const closeCreateGroupModal = () => {
         createGroupModal.classList.remove('show');
         setTimeout(() => createGroupModal.style.display = 'none', 300);
    };

    closeCreateGroup.addEventListener('click', closeCreateGroupModal);

    createGroupSubmitBtn.addEventListener('click', () => {
        const name = groupNameInput.value.trim();
        if (!name) return alert("Enter group name");

        const selected = [];
        groupUserListEl.querySelectorAll('input:checked').forEach(cb => selected.push(cb.value));

        socket.emit('create_group_chat', { name, members: selected });
    });

    // --- Legacy Features (Clipboard/Whiteboard) ---
    // (Preserved from original script logic, but condensed)

    // Navigation
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabContents.forEach(tab => {
                tab.classList.remove('active');
                tab.style.display = 'none';
                if (tab.id === targetId) {
                    tab.classList.add('active');
                    tab.style.display = (targetId === 'chat-area') ? 'flex' : 'block';
                    if (targetId === 'chat-area') tab.style.padding = '0';
                    else tab.style.padding = '1rem'; // Restore padding for others

                    if (targetId === 'whiteboard-area') {
                         tab.style.display = 'flex';
                         tab.style.padding = '0';
                    }
                }
            });
            if (window.innerWidth <= 768) sidebar.classList.remove('open');
        });
    });

    if (sidebarToggle) sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

    // Theme
    const themeBtn = document.getElementById('theme-toggle');
    const toggleTheme = () => {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        const newTheme = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        themeBtn.querySelector('i').className = newTheme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    };
    themeBtn.addEventListener('click', toggleTheme);
    if (localStorage.getItem('theme') === 'light') toggleTheme(); // Initial check

    // Profile
    myProfileDiv.addEventListener('click', () => {
        profileModal.style.display = 'flex';
        setTimeout(() => profileModal.classList.add('show'), 10);
    });
    closeModal.addEventListener('click', () => {
         profileModal.classList.remove('show');
         setTimeout(() => profileModal.style.display = 'none', 300);
    });
    saveProfileBtn.addEventListener('click', () => {
         socket.emit('update_profile', { name: profileNameInput.value, color: profileColorInput.value });
         profileModal.classList.remove('show');
         setTimeout(() => profileModal.style.display = 'none', 300);
    });

    // Clipboard
    socket.on('clipboard_history', (history) => {
        clipboardEntries.innerHTML = '';
        [...history].reverse().forEach(renderClipboardEntry);
    });
    socket.on('new_clipboard_entry', renderClipboardEntry);
    shareClipboardBtn.addEventListener('click', () => {
        if(clipboardInput.value) {
            socket.emit('share_clipboard', { content: clipboardInput.value });
            clipboardInput.value = '';
        }
    });

    function renderClipboardEntry(entry) {
        // ... (Same logic as before) ...
        const div = document.createElement('div');
        div.className = 'clipboard-entry';
        const time = new Date(entry.timestamp * 1000).toLocaleString();
        const contentDiv = document.createElement('div');
        contentDiv.className = 'clipboard-content';
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = entry.content;
        if (entry.type === 'code') hljs.highlightElement(code);
        pre.appendChild(code);
        contentDiv.appendChild(pre);
        div.innerHTML = `<div class="clipboard-header"><span><i class="fa-solid fa-user"></i> ${entry.username}</span><span>${time}</span></div>`;
        div.appendChild(contentDiv);
        clipboardEntries.insertBefore(div, clipboardEntries.firstChild);
    }

    // Whiteboard
    // ... (Reuse logic) ...
    const drawColorInput = document.getElementById('draw-color');
    const drawSizeInput = document.getElementById('draw-size');
    const toolPenBtn = document.getElementById('draw-tool-pen');
    const toolEraserBtn = document.getElementById('draw-tool-eraser');
    const clearBoardBtn = document.getElementById('clear-board-btn');

    // Attach listeners
    canvas.addEventListener('mousedown', (e) => { isDrawing = true; lastX = e.offsetX; lastY = e.offsetY; });
    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const color = currentTool === 'eraser' ? '#ffffff' : currentColor;
        socket.emit('draw', { x0: lastX, y0: lastY, x1: e.offsetX, y1: e.offsetY, color, size: currentSize });
        lastX = e.offsetX; lastY = e.offsetY;
    });
    canvas.addEventListener('mouseup', () => isDrawing = false);

    socket.on('draw', (data) => {
        ctx.beginPath();
        ctx.moveTo(data.x0, data.y0);
        ctx.lineTo(data.x1, data.y1);
        ctx.strokeStyle = data.color;
        ctx.lineWidth = data.size;
        ctx.lineCap = 'round';
        ctx.stroke();
    });
    socket.on('whiteboard_history', (history) => {
        history.forEach(data => {
            ctx.beginPath();
            ctx.moveTo(data.x0, data.y0);
            ctx.lineTo(data.x1, data.y1);
            ctx.strokeStyle = data.color;
            ctx.lineWidth = data.size;
            ctx.lineCap = 'round';
            ctx.stroke();
        });
    });
    socket.on('clear_board', () => ctx.clearRect(0,0,canvas.width,canvas.height));
    clearBoardBtn.addEventListener('click', () => {
         if(confirm("Clear?")) {
             ctx.clearRect(0,0,canvas.width,canvas.height);
             socket.emit('clear_board');
         }
    });
    drawColorInput.addEventListener('change', (e) => currentColor = e.target.value);
    drawSizeInput.addEventListener('change', (e) => currentSize = parseInt(e.target.value));
    toolPenBtn.addEventListener('click', () => { currentTool = 'pen'; toolPenBtn.classList.add('active'); toolEraserBtn.classList.remove('active'); });
    toolEraserBtn.addEventListener('click', () => { currentTool = 'eraser'; toolEraserBtn.classList.add('active'); toolPenBtn.classList.remove('active'); });

    // QR Code
    document.getElementById('server-url').innerText = window.location.href;
    new QRCode(document.getElementById("qrcode"), { text: window.location.href, width: 128, height: 128 });
});
