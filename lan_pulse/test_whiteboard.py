import socketio
import time

# Client A
sio_a = socketio.Client()
draw_data = {'x0': 10, 'y0': 10, 'x1': 20, 'y1': 20, 'color': '#000000', 'size': 5}

# Client B
sio_b = socketio.Client()
history_received = False

@sio_b.event
def whiteboard_history(data):
    global history_received
    print(f"Client B received history: {len(data)} items")
    if len(data) > 0 and data[-1] == draw_data:
        history_received = True

def test():
    try:
        sio_a.connect('http://localhost:5000')
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    time.sleep(1)
    # Client A draws
    sio_a.emit('draw', draw_data)
    time.sleep(1)

    # Client B connects
    sio_b.connect('http://localhost:5000')
    sio_b.emit('join', {})

    start = time.time()
    while not history_received and time.time() - start < 5:
        time.sleep(0.1)

    sio_a.disconnect()
    sio_b.disconnect()

    if history_received:
        print("Test Passed: Whiteboard history synced")
    else:
        print("Test Failed: History not synced")

if __name__ == '__main__':
    test()
