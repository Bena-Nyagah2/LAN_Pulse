document.addEventListener('DOMContentLoaded', () => {
    console.log('LAN Pulse: Initializing...');

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js')
            .then(reg => console.log('Service Worker Registered'))
            .catch(err => console.log('Service Worker Failed', err));
    }

    const socket = io();

    // DOM Elements
    const statusEl = document.getElementById('connection-status');
    const messagesContainer = document.getElementById('messages-container');
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
    const userListEl = document.getElementById('user-list');
    const myNameEl = document.getElementById('my-name');
    const myAvatarEl = document.getElementById('my-avatar');

    // Navigation
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Clipboard
    const clipboardInput = document.getElementById('clipboard-input');
    const shareClipboardBtn = document.getElementById('share-clipboard-btn');
    const clipboardEntries = document.getElementById('clipboard-entries');

    // Profile Modal
    const myProfileDiv = document.querySelector('.my-profile');
    const profileModal = document.getElementById('profile-modal');
    const closeModal = document.getElementById('close-modal');
    const saveProfileBtn = document.getElementById('save-profile-btn');
    const profileNameInput = document.getElementById('profile-name');
    const profileColorInput = document.getElementById('profile-color');

    // Mobile Sidebar
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const mobileStatus = document.getElementById('mobile-status');

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Close sidebar on navigation (mobile)
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
            }
        });
    });

    // Theme
    const themeBtn = document.getElementById('theme-toggle');
    const themeIcon = themeBtn.querySelector('i');

    const toggleTheme = () => {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        if (isDark) {
            document.documentElement.setAttribute('data-theme', 'light');
            themeIcon.className = 'fa-solid fa-moon';
            localStorage.setItem('theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            themeIcon.className = 'fa-solid fa-sun';
            localStorage.setItem('theme', 'dark');
        }
    };

    // Load theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        themeIcon.className = 'fa-solid fa-moon';
    }

    themeBtn.addEventListener('click', toggleTheme);

    // Whiteboard
    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    const drawColorInput = document.getElementById('draw-color');
    const drawSizeInput = document.getElementById('draw-size');
    const toolPenBtn = document.getElementById('draw-tool-pen');
    const toolEraserBtn = document.getElementById('draw-tool-eraser');
    const clearBoardBtn = document.getElementById('clear-board-btn');

    // State
    let myUserId = localStorage.getItem('lan_pulse_user_id');
    let myUser = null;
    let typingTimeout = null;

    // QR Code
    const serverUrl = window.location.href;
    document.getElementById('server-url').innerText = serverUrl;
    new QRCode(document.getElementById("qrcode"), {
        text: serverUrl,
        width: 128,
        height: 128
    });

    // Recording State
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingStartTime = 0;
    let recordingInterval = null;

    // Reactions
    const commonEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡'];

    // Whiteboard State
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentTool = 'pen'; // or 'eraser'
    let currentColor = '#000000';
    let currentSize = 5;

    // Helper: Scroll to bottom
    const scrollToBottom = () => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    // Helper: Group Reactions
    const groupReactions = (reactions) => {
        const groups = {};
        if (!reactions) return groups;

        reactions.forEach(r => {
            if (!groups[r.emoji]) {
                groups[r.emoji] = { count: 0, reactedByMe: false };
            }
            groups[r.emoji].count++;
            if (r.user_id === myUserId) {
                groups[r.emoji].reactedByMe = true;
            }
        });
        return groups;
    };

    // Helper: Render Message
    const renderMessage = (msg) => {
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

        // Reaction Bar
        const reactionBar = document.createElement('div');
        reactionBar.className = 'reaction-bar';
        commonEmojis.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'reaction-btn';
            btn.textContent = emoji;
            btn.onclick = () => {
                socket.emit('add_reaction', { message_id: msg.id, emoji: emoji });
            };
            reactionBar.appendChild(btn);
        });

        // Reactions Container
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'reactions-container';
        reactionsContainer.id = `reactions-${msg.id}`;

        const groups = groupReactions(msg.reactions);
        renderReactions(groups, reactionsContainer, msg.id);

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

    // Load offline history (Moved after renderMessage definition)
    const offlineHistory = JSON.parse(localStorage.getItem('chat_history') || '[]');
    if (offlineHistory.length > 0) {
        offlineHistory.forEach(renderMessage);
    }

    // Offline Logic
    const LOCAL_QUEUE_KEY = 'lan_pulse_queue';

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

    const updateStatus = (text, type) => {
        statusEl.innerText = text;
        statusEl.className = `status-indicator status-${type}`;
        if (mobileStatus) {
            mobileStatus.innerText = text === 'Connected' ? '' : text;
            mobileStatus.className = `status-indicator status-${type}`;
            // Simplify mobile status
            if (type === 'online') mobileStatus.innerHTML = '<i class="fa-solid fa-wifi"></i>';
            else mobileStatus.innerHTML = '<i class="fa-solid fa-wifi" style="opacity: 0.5"></i>';
        }
    };

    socket.on('connect', () => {
        console.log('Connected');
        updateStatus('Connected', 'online');
        console.log('Joining with user ID:', myUserId);
        socket.emit('join', { user_id: myUserId });
        processQueue();
    });

    socket.on('disconnect', () => {
        console.log('Disconnected');
        updateStatus('Offline (Queued)', 'offline');
    });

    const renderReactions = (groups, container, msgId) => {
        container.innerHTML = '';
        for (const [emoji, data] of Object.entries(groups)) {
            const pill = document.createElement('div');
            pill.className = `reaction-pill ${data.reactedByMe ? 'reacted' : ''}`;
            pill.innerHTML = `${emoji} <span>${data.count}</span>`;
            pill.onclick = () => {
                if (data.reactedByMe) {
                    socket.emit('remove_reaction', { message_id: msgId, emoji: emoji });
                } else {
                    socket.emit('add_reaction', { message_id: msgId, emoji: emoji });
                }
            };
            container.appendChild(pill);
        }
    };

    const updateReactions = (msgId, userId, emoji, added) => {
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
                pill.onclick = () => {
                    if (pill.classList.contains('reacted')) {
                         socket.emit('remove_reaction', { message_id: msgId, emoji: emoji });
                    } else {
                         socket.emit('add_reaction', { message_id: msgId, emoji: emoji });
                    }
                };
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

    // Helper: Render Clipboard Entry
    const renderClipboardEntry = (entry) => {
        const div = document.createElement('div');
        div.className = 'clipboard-entry';

        const time = new Date(entry.timestamp * 1000).toLocaleString();

        const contentDiv = document.createElement('div');
        contentDiv.className = 'clipboard-content';

        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = entry.content;

        if (entry.type === 'code') {
             hljs.highlightElement(code);
        }

        pre.appendChild(code);
        contentDiv.appendChild(pre);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(entry.content).then(() => {
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy';
                }, 2000);
            });
        };

        contentDiv.appendChild(copyBtn);

        div.innerHTML = `
            <div class="clipboard-header">
                <span><i class="fa-solid fa-user"></i> ${entry.username}</span>
                <span>${time}</span>
            </div>
        `;
        div.appendChild(contentDiv);

        if (clipboardEntries.firstChild) {
            clipboardEntries.insertBefore(div, clipboardEntries.firstChild);
        } else {
            clipboardEntries.appendChild(div);
        }
    };

    // Helper: Upload File
    const uploadFile = async (file) => {
        if (!file) return;

        console.log('Uploading...', file.name);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', myUserId);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Upload success:', data);
                socket.emit('send_file', {
                    file_id: data.file_id,
                    filename: data.filename,
                    file_type: data.file_type
                });
            } else {
                console.error('Upload failed');
                alert('Upload failed');
            }
        } catch (err) {
            console.error('Error uploading:', err);
            alert('Error uploading file');
        }
    };

    // Helper: Upload Audio
    const uploadAudio = async (blob, duration) => {
        console.log('Uploading audio...', duration, 's');
        const formData = new FormData();
        formData.append('audio', blob, 'voice_note.webm');
        formData.append('user_id', myUserId);
        formData.append('duration', duration);

        try {
            const response = await fetch('/upload_audio', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                socket.emit('send_voice', {
                    file_id: data.file_id,
                    duration: duration
                });
            } else {
                console.error('Audio upload failed');
            }
        } catch (err) {
            console.error('Error uploading audio:', err);
        }
    };

    // Whiteboard Logic
    const drawLine = (x0, y0, x1, y1, color, size, emit) => {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.closePath();

        if (!emit) return;

        socket.emit('draw', {
            x0: x0,
            y0: y0,
            x1: x1,
            y1: y1,
            color: color,
            size: size
        });
    };

    canvas.addEventListener('mousedown', (e) => {
        isDrawing = true;
        lastX = e.offsetX;
        lastY = e.offsetY;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;

        const color = currentTool === 'eraser' ? '#ffffff' : currentColor;
        const size = currentSize; // Eraser size same? Maybe bigger

        drawLine(lastX, lastY, e.offsetX, e.offsetY, color, size, true);
        lastX = e.offsetX;
        lastY = e.offsetY;
    });

    canvas.addEventListener('mouseup', () => isDrawing = false);
    canvas.addEventListener('mouseout', () => isDrawing = false);

    // Whiteboard Toolbar
    drawColorInput.addEventListener('change', (e) => {
        currentColor = e.target.value;
        currentTool = 'pen';
        updateToolUI();
    });

    drawSizeInput.addEventListener('change', (e) => {
        currentSize = parseInt(e.target.value);
    });

    toolPenBtn.addEventListener('click', () => {
        currentTool = 'pen';
        updateToolUI();
    });

    toolEraserBtn.addEventListener('click', () => {
        currentTool = 'eraser';
        updateToolUI();
    });

    clearBoardBtn.addEventListener('click', () => {
        if (confirm("Clear whiteboard for everyone?")) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            socket.emit('clear_board');
        }
    });

    const updateToolUI = () => {
        if (currentTool === 'pen') {
            toolPenBtn.classList.add('active');
            toolEraserBtn.classList.remove('active');
        } else {
            toolPenBtn.classList.remove('active');
            toolEraserBtn.classList.add('active');
        }
    };

    // Recording Logic
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.start();

            // UI
            recordingUI.style.display = 'flex';
            recordingStartTime = Date.now();
            recordingTimer.innerText = "0:00";

            recordingInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
                const min = Math.floor(elapsed / 60);
                const sec = elapsed % 60;
                recordingTimer.innerText = `${min}:${sec.toString().padStart(2, '0')}`;
            }, 1000);

        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Could not access microphone.');
        }
    };

    const stopRecording = (save) => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {

            mediaRecorder.onstop = () => {
                // Stop tracks
                mediaRecorder.stream.getTracks().forEach(t => t.stop());

                if (save) {
                     const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                     const duration = (Date.now() - recordingStartTime) / 1000;
                     uploadAudio(audioBlob, duration);
                }
            };

            mediaRecorder.stop();
            clearInterval(recordingInterval);
            recordingUI.style.display = 'none';
        }
    };


    socket.on('user_info', (user) => {
        // If server returns a different ID (e.g. forced reset), update ours
        // But usually server respects ours if found.
        myUser = user;
        myUserId = user.id;
        localStorage.setItem('lan_pulse_user_id', user.id);

        myNameEl.innerText = user.name;
        myAvatarEl.style.backgroundColor = user.color;
        myAvatarEl.innerText = user.name.substring(0, 2).toUpperCase();

        // Update modal inputs
        profileNameInput.value = user.name;
        profileColorInput.value = user.color;
    });

    socket.on('message_history', (history) => {
        messagesContainer.innerHTML = '';
        history.forEach(renderMessage);
        localStorage.setItem('chat_history', JSON.stringify(history));
    });

    socket.on('new_message', (msg) => {
        renderMessage(msg);
        const history = JSON.parse(localStorage.getItem('chat_history') || '[]');
        history.push(msg);
        // Keep last 50
        if (history.length > 50) history.shift();
        localStorage.setItem('chat_history', JSON.stringify(history));
    });

    socket.on('user_list', (users) => {
        userListEl.innerHTML = '';
        users.forEach(u => {
            const li = document.createElement('li');
            const statusClass = u.status === 'online' ? 'status-online' : 'status-offline';
            li.innerHTML = `
                <div class="user-status-dot ${statusClass}"></div>
                <span style="color: ${u.color}">${u.name}</span>
            `;
            userListEl.appendChild(li);
        });
    });

    socket.on('clipboard_history', (history) => {
        clipboardEntries.innerHTML = '';
        [...history].reverse().forEach(renderClipboardEntry);
    });

    socket.on('new_clipboard_entry', (entry) => {
        renderClipboardEntry(entry);
    });

    socket.on('reaction_added', (data) => {
        updateReactions(data.message_id, data.user_id, data.emoji, true);
    });

    socket.on('reaction_removed', (data) => {
        updateReactions(data.message_id, data.user_id, data.emoji, false);
    });

    socket.on('draw', (data) => {
        drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size, false);
    });

    socket.on('whiteboard_history', (history) => {
        history.forEach(data => {
            drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size, false);
        });
    });

    socket.on('clear_board', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('typing', (data) => {
        typingIndicator.innerText = `${data.username} is typing...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            typingIndicator.innerText = '';
        }, 2000);
    });

    // Event Listeners
    const sendMessage = () => {
        const text = messageInput.value.trim();
        if (text) {
            if (socket.connected) {
                socket.emit('send_message', { text });
            } else {
                addToQueue('message', { text });
                // Optimistic UI
                renderMessage({
                    id: 'temp-' + Date.now(),
                    user_id: myUserId,
                    username: myUser ? myUser.name : 'Me',
                    user_color: myUser ? myUser.color : '#ccc',
                    content: text,
                    timestamp: Date.now() / 1000,
                    type: 'text',
                    reactions: []
                });
            }
            messageInput.value = '';
        }
    };

    sendBtn.addEventListener('click', sendMessage);

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    messageInput.addEventListener('input', () => {
        socket.emit('typing');
    });

    fileBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            uploadFile(fileInput.files[0]);
            fileInput.value = '';
        }
    });

    const micBtnEl = document.getElementById('mic-btn');
    if (micBtnEl) {
         micBtnEl.addEventListener('click', startRecording);
    }

    const stopBtnEl = document.getElementById('stop-recording');
    if (stopBtnEl) {
        stopBtnEl.addEventListener('click', () => stopRecording(true));
    }

    const cancelBtnEl = document.getElementById('cancel-recording');
    if (cancelBtnEl) {
        cancelBtnEl.addEventListener('click', () => stopRecording(false));
    }

    // Nav Listeners
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');

            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            tabContents.forEach(tab => {
                if (tab.id === targetId) {
                    tab.classList.add('active');
                    tab.style.display = 'flex';
                } else {
                    tab.classList.remove('active');
                    tab.style.display = 'none';
                }
            });
        });
    });

    // Clipboard Listeners
    shareClipboardBtn.addEventListener('click', () => {
        const content = clipboardInput.value;
        if (content) {
            socket.emit('share_clipboard', { content });
            clipboardInput.value = '';
        }
    });

    // Profile Modal Listeners
    myProfileDiv.addEventListener('click', () => {
        profileModal.style.display = 'flex';
        // Force reflow for transition
        void profileModal.offsetWidth;
        profileModal.classList.add('show');
    });

    const hideModal = () => {
        profileModal.classList.remove('show');
        setTimeout(() => {
            profileModal.style.display = 'none';
        }, 300);
    };

    closeModal.addEventListener('click', hideModal);

    window.addEventListener('click', (event) => {
        if (event.target == profileModal) {
            hideModal();
        }
    });

    saveProfileBtn.addEventListener('click', () => {
        const name = profileNameInput.value.trim();
        const color = profileColorInput.value;

        if (name) {
            socket.emit('update_profile', { name, color });
            hideModal();
        } else {
            alert("Name cannot be empty");
        }
    });
});
