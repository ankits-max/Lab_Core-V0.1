from flask import Flask, render_template, jsonify
from services import flashlight_on, flashlight_off, take_photo

# register flasher blueprint
from flasher import bp as flasher_bp

import os

app = Flask(__name__, template_folder='templates', static_folder='static')
app.register_blueprint(flasher_bp)

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
    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "0.0.0.0")
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host=host, port=port, debug=debug)
