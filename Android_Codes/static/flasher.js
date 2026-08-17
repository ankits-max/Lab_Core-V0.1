// file: Android_Codes/static/flasher.js
// Minimal client to power the dashboard UI.
// Expects the page to have these IDs: platform buttons, remoteHostRow, remoteHost, authToken,
// buttons: btnFlashOn, btnFlashOff, btnPhoto, btnUpload, btnFlash,
// fileInput, hostsFiles, confirmCheck, opid, opStatus, opLog, deviceType, targetPart

(function(){
  function baseUrl(){
    const mode = document.querySelector('input[name="hostmode"]:checked')?.value;
    if(mode === 'local') return window.location.origin;
    const remote = document.getElementById('remoteHost')?.value.trim();
    if(!remote) return null;
    return remote.replace(/\/$/, '');
  }

  function tokenHeader(){
    const tok = document.getElementById('authToken')?.value.trim();
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
    if(!fi || !fi.files.length) { alert('Choose a file first'); return; }
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
      if(!ul) return;
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
    const st = document.getElementById('opStatus');
    if(st) st.textContent = 'Selected: ' + name;
    const oid = document.getElementById('opid'); if(oid) oid.textContent = '-';
    const lg = document.getElementById('opLog'); if(lg) lg.textContent = '-';
    window._selectedFile = name;
  }

  async function startFlash(){
    if(!document.getElementById('confirmCheck')?.checked){ alert('Please accept the risks'); return; }
    const dev = document.getElementById('deviceType')?.value;
    const target = document.getElementById('targetPart')?.value;
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
        if(statusEl) statusEl.textContent = JSON.stringify(s,null,2);
        const l = await apiFetch('GET','/flasher/logs/'+opid);
        if(logEl) logEl.textContent = l.log || '';
        if(s.status === 'done' || s.status === 'error') done = true;
      }catch(e){
        if(statusEl) statusEl.textContent = 'Error polling: ' + e;
        done = true;
      }
      if(!done) await new Promise(r=>setTimeout(r,2000));
    }
  }

  // Platform UI management
  function showSection(id){
    ['hostConfigSection','androidSection','piSection','laptopSection'].forEach(s=>{
      const el = document.getElementById(s);
      if(!el) return;
      el.style.display = (s===id) ? 'block' : 'none';
    });
    // always show hostConfig when selecting a platform
    const hostCfg = document.getElementById('hostConfigSection'); if(hostCfg) hostCfg.style.display = 'block';
  }

  function openAndroidApp(choice){
    // choice: 'flashlight' or 'flasher'
    showSection('androidSection');
    if(choice === 'flashlight'){
      // scroll to quick services
      const quick = document.getElementById('btnFlashOn');
      if(quick) quick.focus();
      const qs = document.getElementById('quickStatus'); if(qs) qs.textContent = 'Flashlight app opened.';
    }else{
      // show flasher area and focus upload
      const up = document.getElementById('fileInput'); if(up) up.focus();
      const os = document.getElementById('opStatus'); if(os) os.textContent = 'Flasher app opened.';
    }
    // refresh file list for flasher
    listFiles().catch(()=>{});
  }

  // wire UI - platform buttons
  const btnPlatformAndroid = document.getElementById('btnPlatformAndroid');
  const btnPlatformPi = document.getElementById('btnPlatformPi');
  const btnPlatformLaptop = document.getElementById('btnPlatformLaptop');
  if(btnPlatformAndroid){
    btnPlatformAndroid.addEventListener('click', ()=>{
      // show an in-page modal with choices (avoids blocked native dialogs)
      let modal = document.getElementById('labcore-android-modal');
      if(!modal){
        modal = document.createElement('div');
        modal.id = 'labcore-android-modal';
        modal.style = 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
        modal.innerHTML = `
          <div style="background:#111;color:#fff;padding:16px;border-radius:8px;max-width:320px;text-align:center;">
            <h3 style="margin-top:0;">Android — Choose app</h3>
            <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;">
              <button id="labcore-open-flashlight" style="padding:8px 12px;">Flashlight</button>
              <button id="labcore-open-flasher" style="padding:8px 12px;">Flasher</button>
            </div>
            <div style="margin-top:12px;"><button id="labcore-close-modal" style="padding:6px 10px;background:#333;">Cancel</button></div>
          </div>`;
        document.body.appendChild(modal);
        document.getElementById('labcore-open-flashlight').addEventListener('click', ()=>{ document.body.removeChild(modal); openAndroidApp('flashlight'); });
        document.getElementById('labcore-open-flasher').addEventListener('click', ()=>{ document.body.removeChild(modal); openAndroidApp('flasher'); });
        document.getElementById('labcore-close-modal').addEventListener('click', ()=>{ document.body.removeChild(modal); });
      }
    });
  }
  if(btnPlatformPi){ btnPlatformPi.addEventListener('click', ()=>{ showSection('piSection'); }); }
  if(btnPlatformLaptop){ btnPlatformLaptop.addEventListener('click', ()=>{ showSection('laptopSection'); }); }

  // App buttons
  const btnAppFlashlight = document.getElementById('btnAppFlashlight');
  const btnAppHeimdall = document.getElementById('btnAppHeimdall');
  if(btnAppFlashlight){ btnAppFlashlight.addEventListener('click', ()=> openAndroidApp('flashlight')); }
  if(btnAppHeimdall){ btnAppHeimdall.addEventListener('click', ()=>{
    alert('Heimdall flasher is disabled in this build. Use the Flasher section to upload files.');
    openAndroidApp('flasher');
  }); }

  // wire existing controls
  const flashOnBtn = document.getElementById('btnFlashOn'); if(flashOnBtn) flashOnBtn.addEventListener('click', ()=>quickCall('/service/flashlight/on','quickStatus'));
  const flashOffBtn = document.getElementById('btnFlashOff'); if(flashOffBtn) flashOffBtn.addEventListener('click', ()=>quickCall('/service/flashlight/off','quickStatus'));
  const photoBtn = document.getElementById('btnPhoto'); if(photoBtn) photoBtn.addEventListener('click', ()=>quickCall('/service/photo','quickStatus'));
  const uploadBtn = document.getElementById('btnUpload'); if(uploadBtn) uploadBtn.addEventListener('click', uploadFile);
  const flashBtn = document.getElementById('btnFlash'); if(flashBtn) flashBtn.addEventListener('click', startFlash);

  document.querySelectorAll('input[name="hostmode"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      const row = document.getElementById('remoteHostRow');
      if(row) row.style.display = r.value === 'remote' ? 'block' : 'none';
    });
  });

  // init
  let selectedFile = null;
  // show nothing until platform selected
  const hostCfg = document.getElementById('hostConfigSection'); if(hostCfg) hostCfg.style.display = 'none';
  document.getElementById('hostsFiles') && listFiles();

  // nodes-uart canvas interaction: draw dot and notify backend if available
  (function attachNodesUart(){
    const nodesUart = document.getElementById('nodes-uart');
    // try a few common canvas ids
    const nodeCanvas = document.getElementById('nodeCanvas') || document.getElementById('nodes-canvas') || document.getElementById('nodesCanvas');
    if(!nodesUart && !nodeCanvas) return;

    // if canvas present, attach click handler that draws a dot
    if(nodeCanvas && nodeCanvas.getContext){
      const ctx = nodeCanvas.getContext('2d');
      // make canvas high-DPI friendly
      function resizeCanvas(){
        const rect = nodeCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        nodeCanvas.width = rect.width * dpr;
        nodeCanvas.height = rect.height * dpr;
        nodeCanvas.style.width = rect.width + 'px';
        nodeCanvas.style.height = rect.height + 'px';
        ctx.scale(dpr,dpr);
      }
      // resize once
      try{ resizeCanvas(); }catch(e){}
      nodeCanvas.addEventListener('click', async function(ev){
        const rect = nodeCanvas.getBoundingClientRect();
        const x = Math.round(ev.clientX - rect.left);
        const y = Math.round(ev.clientY - rect.top);
        // draw a small circle
        try{
          ctx.fillStyle = '#2ecc71';
          ctx.beginPath();
          ctx.arc(x,y,6,0,Math.PI*2);
          ctx.fill();
        }catch(e){ console.debug('draw failed', e); }
        const st = document.getElementById('opStatus'); if(st) st.textContent = `nodes-uart clicked at ${x},${y}`;
        // attempt to notify backend endpoint (optional)
        try{
          await apiFetch('POST','/nodes/uart/click',{x,y});
        }catch(e){ /* ignore: endpoint may not exist */ }
      });
    } else if(nodesUart){
      // fallback: attach click to the nodesUart element itself
      nodesUart.addEventListener('click', function(ev){
        const st = document.getElementById('opStatus'); if(st) st.textContent = 'nodes-uart element clicked';
      });
    }
  })();

})();
