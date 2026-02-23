import socketio
import time
import sqlite3

sio = socketio.Client()
connected = False
user_data = None

@sio.event
def connect():
    global connected
    connected = True
    print("Connected!")
    # Emit join
    sio.emit('join', {})

@sio.event
def user_info(data):
    global user_data
    user_data = data
    print(f"User info received: {data}")

@sio.event
def new_message(data):
    print(f"New message received: {data['content']} from {data['username']}")

def test():
    sio.connect('http://localhost:5000')

    # Wait for connection and user info
    timeout = 5
    start = time.time()
    while not user_data and time.time() - start < timeout:
        time.sleep(0.1)

    if not user_data:
        print("Failed to get user info")
        return

    # Send message
    msg_content = "Hello World Test"
    sio.emit('send_message', {'text': msg_content})

    time.sleep(1) # Wait for processing
    sio.disconnect()

    # Check DB
    conn = sqlite3.connect('lan_pulse/lan_pulse.db')
    c = conn.cursor()
    c.execute("SELECT * FROM messages WHERE content = ?", (msg_content,))
    row = c.fetchone()
    conn.close()

    if row:
        print("Test Passed: Message found in DB")
    else:
        print("Test Failed: Message not found in DB")

if __name__ == '__main__':
    test()
