// file: Android_Codes/static/flasher.js
// Minimal client to power the dashboard UI.
// Expects the page to have these IDs: remoteHostRow, remoteHost, authToken,
// buttons: btnFlashOn, btnFlashOff, btnPhoto, btnUpload, btnFlash,
// fileInput, hostsFiles, confirmCheck, opid, opStatus, opLog, deviceType, targetPart

(function(){
  function baseUrl(){
    const mode = document.querySelector('input[name="hostmode"]:checked').value;
    if(mode === 'local') return window.location.origin;
    const remote = document.getElementById('remoteHost').value.trim();
    if(!remote) return null;
    return remote.replace(/\/$/, '');
  }

  function tokenHeader(){
    const tok = document.getElementById('authToken').value.trim();
    return tok ? { 'Authorization': 'Bearer ' + tok } : {};
  }

  async function apiFetch(method, path, body, isForm=false){
    const urlBase = baseUrl();
    if(!urlBase) { alert('Set target host first'); throw new Error('no host'); }
    const url = urlBase + path;
    const headers = Object.assign({}, tokenHeader());
    if(!isForm && body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const opts = { method, headers, body: body && !(body instanceof FormData) ? JSON.stringify(body) : body };
    const res = await fetch(url, opts);
    if(!res.ok) {
      const txt = await res.text();
      throw new Error('HTTP ' + res.status + ': ' + txt);
    }
    return res.json();
  }

  // Quick services
  async function quickCall(path, outEl){
    try{
      const json = await apiFetch('GET', path);
      document.getElementById(outEl).textContent = JSON.stringify(json, null, 2);
    }catch(e){
      document.getElementById(outEl).textContent = e.toString();
    }
  }

  // Upload file
  async function uploadFile(){
    const fi = document.getElementById('fileInput');
    if(!fi.files.length) { alert('Choose a file first'); return; }
    const fd = new FormData();
    fd.append('file', fi.files[0]);
    try{
      const res = await apiFetch('POST', '/flasher/upload', fd, true);
      alert('Uploaded: ' + res.file);
      await listFiles();
    }catch(e){
      alert('Upload failed: ' + e);
    }
  }

  async function listFiles(){
    try{
      const res = await apiFetch('GET', '/flasher/list');
      const ul = document.getElementById('hostsFiles');
      ul.innerHTML = '';
      (res.files || []).forEach(f=>{
        const li = document.createElement('li');
        const btnSel = document.createElement('button');
        btnSel.textContent = 'Select';
        btnSel.onclick = ()=>{ selectedFile = f; highlightSelected(f); };
        const btnDel = document.createElement('button');
        btnDel.textContent = 'Delete';
        btnDel.onclick = async ()=>{
          if(!confirm('Delete '+f+'?')) return;
          await apiFetch('POST','/flasher/delete',{file:f});
          await listFiles();
        };
        li.appendChild(document.createTextNode(f + ' '));
        li.appendChild(btnSel);
        li.appendChild(document.createTextNode(' '));
        li.appendChild(btnDel);
        ul.appendChild(li);
      });
    }catch(e){
      console.error(e);
    }
  }

  function highlightSelected(name){
    document.getElementById('opStatus').textContent = 'Selected: ' + name;
    document.getElementById('opid').textContent = '-';
    document.getElementById('opLog').textContent = '-';
    window._selectedFile = name;
  }

  async function startFlash(){
    if(!document.getElementById('confirmCheck').checked){ alert('Please accept the risks'); return; }
    const dev = document.getElementById('deviceType').value;
    const target = document.getElementById('targetPart').value;
    const file = window._selectedFile;
    if(!file){ alert('Select an uploaded file first'); return; }
    try{
      const res = await apiFetch('POST','/flasher/flash',{ host:'local', device:dev, file, target, confirm:true });
      const opid = res.opid;
      document.getElementById('opid').textContent = opid;
      pollStatus(opid);
    }catch(e){
      alert('Flash failed: ' + e);
    }
  }

  async function pollStatus(opid){
    const statusEl = document.getElementById('opStatus');
    const logEl = document.getElementById('opLog');
    let done=false;
    while(!done){
      try{
        const s = await apiFetch('GET','/flasher/status/'+opid);
        statusEl.textContent = JSON.stringify(s,null,2);
        const l = await apiFetch('GET','/flasher/logs/'+opid);
        logEl.textContent = l.log || '';
        if(s.status === 'done' || s.status === 'error') done = true;
      }catch(e){
        statusEl.textContent = 'Error polling: ' + e;
        done = true;
      }
      if(!done) await new Promise(r=>setTimeout(r,2000));
    }
  }

  // wire UI
  document.getElementById('btnFlashOn').addEventListener('click', ()=>quickCall('/service/flashlight/on','quickStatus'));
  document.getElementById('btnFlashOff').addEventListener('click', ()=>quickCall('/service/flashlight/off','quickStatus'));
  document.getElementById('btnPhoto').addEventListener('click', ()=>quickCall('/service/photo','quickStatus'));
  document.getElementById('btnUpload').addEventListener('click', uploadFile);
  document.getElementById('btnFlash').addEventListener('click', startFlash);

  document.querySelectorAll('input[name="hostmode"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      document.getElementById('remoteHostRow').style.display = r.value === 'remote' ? 'block' : 'none';
    });
  });

  // init
  let selectedFile = null;
  listFiles();

})();
