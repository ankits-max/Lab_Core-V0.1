import subprocess
import os
import time

PHOTO_DIR = os.path.expanduser("~/storage/shared/LabCore")

os.makedirs(PHOTO_DIR, exist_ok=True)


def flashlight_on():
    subprocess.run(["termux-torch", "on"])
    return {
        "service": "flashlight.service",
        "status": "ON"
    }


def flashlight_off():
    subprocess.run(["termux-torch", "off"])
    return {
        "service": "flashlight.service",
        "status": "OFF"
    }


def take_photo():

    filename = os.path.join(
        PHOTO_DIR,
        f"photo_{int(time.time())}.jpg"
    )

    subprocess.run([
        "termux-camera-photo",
        "-c",
        "0",
        filename
    ])

    return {
        "service": "photo.service",
        "status": "Captured",
        "file": filename
    }
