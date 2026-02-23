import socketio
import time
import sqlite3

sio = socketio.Client()
connected = False
last_msg_id = None
reaction_received = False

@sio.event
def connect():
    global connected
    connected = True
    print("Connected!")
    sio.emit('join', {})

@sio.event
def new_message(data):
    global last_msg_id
    last_msg_id = data['id']
    print(f"New message ID: {last_msg_id}")

@sio.event
def reaction_added(data):
    global reaction_received
    reaction_received = True
    print(f"Reaction added: {data}")

def test():
    try:
        sio.connect('http://localhost:5000')
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    # Send message
    sio.emit('send_message', {'text': 'React to me!'})

    # Wait for message ID
    start = time.time()
    while not last_msg_id and time.time() - start < 5:
        time.sleep(0.1)

    if not last_msg_id:
        print("Failed to get message ID")
        return

    # Add reaction
    emoji = '👍'
    sio.emit('add_reaction', {'message_id': last_msg_id, 'emoji': emoji})

    # Wait for reaction broadcast
    start = time.time()
    while not reaction_received and time.time() - start < 5:
        time.sleep(0.1)

    sio.disconnect()

    if reaction_received:
        # Check DB
        conn = sqlite3.connect('lan_pulse/lan_pulse.db')
        c = conn.cursor()
        c.execute("SELECT * FROM reactions WHERE message_id = ? AND emoji = ?", (last_msg_id, emoji))
        row = c.fetchone()
        conn.close()

        if row:
             print("Test Passed: Reaction persisted in DB")
        else:
             print("Test Failed: Reaction not found in DB")
    else:
        print("Test Failed: Reaction broadcast not received")

if __name__ == '__main__':
    test()
