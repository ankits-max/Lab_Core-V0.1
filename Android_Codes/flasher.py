from flask import Blueprint, render_template, request, jsonify, current_app
import os
import shutil
import subprocess
from werkzeug.utils import secure_filename

bp = Blueprint('flasher', __name__, template_folder='templates', static_folder='static', url_prefix='/flasher')

FLASH_DIR = os.path.expanduser("~/storage/shared/LabCore/roms")
os.makedirs(FLASH_DIR, exist_ok=True)


@bp.route('/')
def index():
    return render_template('flasher.html')


@bp.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'no file part'}), 400
    f = request.files['file']
    if f.filename == '':
        return jsonify({'error': 'no selected file'}), 400

    filename = secure_filename(f.filename)
    filepath = os.path.join(FLASH_DIR, filename)
    f.save(filepath)

    return jsonify({'status': 'saved', 'file': filename, 'path': filepath})


@bp.route('/list')
def list_files():
    try:
        files = [f for f in os.listdir(FLASH_DIR) if os.path.isfile(os.path.join(FLASH_DIR, f))]
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    return jsonify({'files': files})


@bp.route('/delete', methods=['POST'])
def delete_file():
    filename = request.form.get('file') or (request.json and request.json.get('file'))
    if not filename:
        return jsonify({'error': 'file parameter required'}), 400
    path = os.path.join(FLASH_DIR, secure_filename(filename))
    if not os.path.exists(path):
        return jsonify({'error': 'file not found'}), 404
    try:
        os.remove(path)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    return jsonify({'status': 'deleted', 'file': filename})


def _which(cmd):
    return shutil.which(cmd)


@bp.route('/flash', methods=['POST'])
def flash():
    data = request.json or request.form
    host = data.get('host')
    device = data.get('device')
    filename = data.get('file')
    target = data.get('target')
    confirm = data.get('confirm') in (True, 'true', '1', 'yes')

    if not all([host, device, filename, target]):
        return jsonify({'error': 'host, device, file, and target are required'}), 400

    if not confirm:
        return jsonify({'error': 'confirmation required', 'message': 'Include confirm=true to actually run the flashing command (dangerous)'}), 400

    filepath = os.path.join(FLASH_DIR, secure_filename(filename))
    if not os.path.exists(filepath):
        return jsonify({'error': 'file not found', 'file': filename}), 404

    results = []

    device_key = (device or '').lower()

    # Samsung devices -> heimdall
    if device_key in ('samsung', 'heimdall'):
        if not _which('heimdall'):
            return jsonify({'error': 'heimdall not found on host', 'install': 'Please install heimdall on this machine (e.g. apt install heimdall)'}), 400
        target_map = {
            'recovery': 'RECOVERY',
            'boot': 'BOOT',
            'system': 'SYSTEM',
            'pit': 'PIT',
            'cache': 'CACHE'
        }
        t = target_map.get(target.lower())
        if not t:
            return jsonify({'error': 'invalid target for heimdall', 'valid_targets': list(target_map.keys())}), 400
        cmd = ['heimdall', 'flash', '--' + t, filepath]
        try:
            p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=900)
            results.append({'cmd': cmd, 'returncode': p.returncode, 'output': p.stdout})
        except Exception as e:
            results.append({'cmd': cmd, 'error': str(e)})

    # Fastboot devices
    elif device_key in ('fastboot', 'generic-fastboot'):
        if not _which('fastboot'):
            return jsonify({'error': 'fastboot not found on host'}), 400
        # typical: fastboot flash <partition> <file>
        cmd = ['fastboot', 'flash', target, filepath]
        try:
            p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=900)
            results.append({'cmd': cmd, 'returncode': p.returncode, 'output': p.stdout})
        except Exception as e:
            results.append({'cmd': cmd, 'error': str(e)})

    # ADB/Sideload
    elif device_key in ('adb', 'sideload'):
        if not _which('adb'):
            return jsonify({'error': 'adb not found on host'}), 400
        if target.lower() == 'sideload':
            cmd = ['adb', 'sideload', filepath]
        else:
            # fallback to pushing to /sdcard
            dest = '/sdcard/' + os.path.basename(filepath)
            cmd = ['adb', 'push', filepath, dest]
        try:
            p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=900)
            results.append({'cmd': cmd, 'returncode': p.returncode, 'output': p.stdout})
        except Exception as e:
            results.append({'cmd': cmd, 'error': str(e)})

    else:
        return jsonify({'error': 'unsupported device type', 'supported': ['heimdall/samsung', 'fastboot', 'adb/sideload']}), 400

    return jsonify({'results': results})
