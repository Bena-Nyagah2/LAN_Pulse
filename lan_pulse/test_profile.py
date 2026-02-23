import socketio
import time
import sqlite3

sio = socketio.Client()
connected = False
my_user = None

@sio.event
def connect():
    global connected
    connected = True
    print("Connected!")
    sio.emit('join', {})

@sio.event
def user_info(data):
    global my_user
    my_user = data
    print(f"User info: {data}")

def test():
    try:
        sio.connect('http://localhost:5000')
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    # Wait for user info
    start = time.time()
    while not my_user and time.time() - start < 5:
        time.sleep(0.1)

    if not my_user:
        print("Failed to get user info")
        return

    # Update profile
    new_name = "TestMaster"
    new_color = "#ff0000"
    sio.emit('update_profile', {'name': new_name, 'color': new_color})

    time.sleep(1)
    sio.disconnect()

    # Check DB
    conn = sqlite3.connect('lan_pulse/lan_pulse.db')
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (my_user['id'],))
    row = c.fetchone()
    conn.close()

    if row:
        db_name = row[1] # name is 2nd column
        db_color = row[2] # color is 3rd column
        print(f"DB Name: {db_name}, DB Color: {db_color}")

        if db_name == new_name and db_color == new_color:
             print("Test Passed: Profile updated in DB")
        else:
             print("Test Failed: Profile mismatch")
    else:
        print("Test Failed: User not found in DB")

if __name__ == '__main__':
    test()
