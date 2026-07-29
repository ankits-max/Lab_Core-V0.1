import os
import shutil
import subprocess
import threading
import uuid
import time
import json
from flask import Blueprint, render_template, request, jsonify, current_app, send_file
from werkzeug.utils import secure_filename

bp = Blueprint('flasher', __name__, template_folder='templates', static_folder='static', url_prefix='/flasher')

# Configuration via environment
FLASH_DIR = os.path.expanduser(os.environ.get('LABCORE_FLASH_DIR', '~/storage/shared/LabCore/roms'))
AUTH_TOKEN = os.environ.get('LABCORE_TOKEN')  # if set, endpoints require Bearer token
MAX_UPLOAD_BYTES = int(os.environ.get('LABCORE_MAX_UPLOAD_BYTES', str(800 * 1024 * 1024)))  # 800 MB
ALLOWED_EXT = {'.img', '.zip', '.tar', '.md5', '.pit', '.bin', '.tar.md5'}

os.makedirs(FLASH_DIR, exist_ok=True)
OPS_DIR = os.path.join(FLASH_DIR, 'ops')
os.makedirs(OPS_DIR, exist_ok=True)


def _which(cmd):
    return shutil.which(cmd)


def _require_auth():
    # Returns True if allowed, False otherwise
    if not AUTH_TOKEN:
        return True
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth.split(' ', 1)[1].strip()
        return token == AUTH_TOKEN
    # also allow token via query param for ease (not ideal for security)
    token = request.args.get('token') or request.form.get('token')
    if token:
        return token == AUTH_TOKEN
    return False


def _allowed_file(filename):
    name = filename.lower()
    for ext in ALLOWED_EXT:
        if name.endswith(ext):
            return True
    return False


@bp.route('/')
def index():
    return render_template('index.html')


@bp.route('/upload', methods=['POST'])
def upload():
    if not _require_auth():
        return jsonify({'error': 'unauthorized'}), 401

    if 'file' not in request.files:
        return jsonify({'error': 'no file part'}), 400
    f = request.files['file']
    if f.filename == '':
        return jsonify({'error': 'no selected file'}), 400

    filename = secure_filename(f.filename)
    if not _allowed_file(filename):
        return jsonify({'error': 'file type not allowed', 'allowed': list(ALLOWED_EXT)}), 400

    # basic size check
    content_length = request.content_length or 0
    if content_length > MAX_UPLOAD_BYTES:
        return jsonify({'error': 'file too large', 'max_bytes': MAX_UPLOAD_BYTES}), 413

    filepath = os.path.join(FLASH_DIR, filename)
    try:
        f.save(filepath)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
    if not _require_auth():
        return jsonify({'error': 'unauthorized'}), 401

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


# Background operation management

def _op_path(opid):
    return os.path.join(OPS_DIR, opid)


def _write_op_status(opid, data):
    p = _op_path(opid)
    try:
        with open(p + '.json', 'w') as fh:
            json.dump(data, fh)
    except Exception:
        pass


def _append_op_log(opid, text):
    p = _op_path(opid) + '.log'
    try:
        with open(p, 'a') as fh:
            fh.write(text)
            fh.flush()
    except Exception:
        pass


def _run_flash_job(opid, host, device, filepath, target):
    # write initial status
    _write_op_status(opid, {'status': 'running', 'host': host, 'device': device, 'file': os.path.basename(filepath), 'target': target, 'start': time.time()})
    _append_op_log(opid, f"Starting flash job {opid}\n")

    device_key = (device or '').lower()
    results = []

    try:
        # Samsung devices -> heimdall
        if device_key in ('samsung', 'heimdall'):
            if not _which('heimdall'):
                raise RuntimeError('heimdall not found on host')
            target_map = {
                'recovery': 'RECOVERY',
                'boot': 'BOOT',
                'system': 'SYSTEM',
                'pit': 'PIT',
                'cache': 'CACHE'
            }
            t = target_map.get(target.lower())
            if not t:
                raise RuntimeError('invalid target for heimdall')
            cmd = ['heimdall', 'flash', '--' + t, filepath]
            _append_op_log(opid, f"Running: {' '.join(cmd)}\n")
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in p.stdout:
                _append_op_log(opid, line)
            p.wait()
            results.append({'cmd': cmd, 'returncode': p.returncode})

        # Fastboot devices
        elif device_key in ('fastboot', 'generic-fastboot'):
            if not _which('fastboot'):
                raise RuntimeError('fastboot not found on host')
            cmd = ['fastboot', 'flash', target, filepath]
            _append_op_log(opid, f"Running: {' '.join(cmd)}\n")
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in p.stdout:
                _append_op_log(opid, line)
            p.wait()
            results.append({'cmd': cmd, 'returncode': p.returncode})

        # ADB/Sideload
        elif device_key in ('adb', 'sideload'):
            if not _which('adb'):
                raise RuntimeError('adb not found on host')
            if target.lower() == 'sideload':
                cmd = ['adb', 'sideload', filepath]
            else:
                dest = '/sdcard/' + os.path.basename(filepath)
                cmd = ['adb', 'push', filepath, dest]
            _append_op_log(opid, f"Running: {' '.join(cmd)}\n")
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in p.stdout:
                _append_op_log(opid, line)
            p.wait()
            results.append({'cmd': cmd, 'returncode': p.returncode})

        else:
            raise RuntimeError('unsupported device type')

        _write_op_status(opid, {'status': 'done', 'results': results, 'end': time.time()})
        _append_op_log(opid, f"Job {opid} finished.\n")
    except Exception as e:
        _write_op_status(opid, {'status': 'error', 'error': str(e), 'end': time.time()})
        _append_op_log(opid, f"Error: {str(e)}\n")


@bp.route('/flash', methods=['POST'])
def flash():
    if not _require_auth():
        return jsonify({'error': 'unauthorized'}), 401

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

    # create operation id and launch background job
    opid = uuid.uuid4().hex
    _write_op_status(opid, {'status': 'queued', 'start': time.time()})

    th = threading.Thread(target=_run_flash_job, args=(opid, host, device, filepath, target), daemon=True)
    th.start()

    return jsonify({'opid': opid, 'status': 'started'})


@bp.route('/status/<opid>')
def status(opid):
    p = _op_path(opid) + '.json'
    if not os.path.exists(p):
        return jsonify({'error': 'op not found'}), 404
    try:
        with open(p, 'r') as fh:
            data = json.load(fh)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    return jsonify(data)


@bp.route('/logs/<opid>')
def logs(opid):
    p = _op_path(opid) + '.log'
    if not os.path.exists(p):
        return jsonify({'error': 'logs not found'}), 404
    try:
        # return last 20000 chars to avoid huge responses
        with open(p, 'r') as fh:
            data = fh.read()
            if len(data) > 20000:
                data = data[-20000:]
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    return jsonify({'log': data})


@bp.route('/download/<filename>')
def download_file(filename):
    # simple download helper
    filename = secure_filename(filename)
    path = os.path.join(FLASH_DIR, filename)
    if not os.path.exists(path):
        return jsonify({'error': 'file not found'}), 404
    return send_file(path, as_attachment=True)
