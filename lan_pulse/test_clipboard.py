import socketio
import time
import sqlite3

sio = socketio.Client()
connected = False

@sio.event
def connect():
    global connected
    connected = True
    print("Connected!")
    sio.emit('join', {})

@sio.event
def new_clipboard_entry(data):
    print(f"Clipboard entry received: {data['content']}")

def test():
    try:
        sio.connect('http://localhost:5000')
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    time.sleep(1)

    content = "print('Hello Clipboard')"
    sio.emit('share_clipboard', {'content': content})

    time.sleep(1)
    sio.disconnect()

    # Check DB
    conn = sqlite3.connect('lan_pulse/lan_pulse.db')
    c = conn.cursor()
    c.execute("SELECT * FROM clipboard WHERE content = ?", (content,))
    row = c.fetchone()
    conn.close()

    if row:
        print("Test Passed: Clipboard entry found in DB")
    else:
        print("Test Failed: Clipboard entry not found")

if __name__ == '__main__':
    test()
