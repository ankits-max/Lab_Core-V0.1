from flask import Flask, render_template, jsonify
from services import flashlight_on, flashlight_off, take_photo

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/service/flashlight/on")
def flash_on():
    return jsonify(flashlight_on())

@app.route("/service/flashlight/off")
def flash_off():
    return jsonify(flashlight_off())

@app.route("/service/photo")
def photo():
    return jsonify(take_photo())

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
