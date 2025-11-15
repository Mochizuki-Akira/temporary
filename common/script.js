// ===============================================================
// common/script.js — teacher auth, print button, global nav buttons
// ===============================================================

(function(){
  const TEACHER_HASH = "748af7710781fcc365ace7e0ae5a9c15f030c83a3e42308982ae970c24e97f1b";

  // ------------------------------
  // modal HTML（你的原始代码保持不变）
  // ------------------------------
  const modalHTML = `
  <div id="pwd-modal" class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:10000">
    <div class="modal" role="dialog" aria-modal="true" style="background:#fff;padding:24px 28px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:320px;width:100%;">
      <h3 style="margin:0 0 10px;font-size:18px;">教師モードへ切り替え</h3>
      <label>请输入教师密码：</label>
      <input id="pwd-input" type="password" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:15px;margin-top:6px;" />
      <div class="modal-buttons" style="margin-top:16px;text-align:right;">
        <button class="cancel" style="margin-left:8px;padding:6px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;font-size:14px;background:#e2e8f0;">取消</button>
        <button class="ok" style="margin-left:8px;padding:6px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;font-size:14px;background:#2563eb;color:#fff;border:none;">确定</button>
      </div>
    </div>
  </div>`;

  function ensureModal(){
    if(document.getElementById('pwd-modal')) return;
    const div=document.createElement('div');
    div.innerHTML=modalHTML.trim();
    document.body.appendChild(div.firstChild);
  }

  async function sha256Hex(s){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  const authed = () => localStorage.getItem('teacher_auth')==='ok';
  const setAuthed = ok => ok ? localStorage.setItem('teacher_auth','ok') : localStorage.removeItem('teacher_auth');

  function setView(mode){
    const isTeacher=(mode==='teacher');
    document.body.classList.toggle('teacher',isTeacher);
    document.body.classList.toggle('student',!isTeacher);
    document.querySelectorAll('.teacher-only').forEach(e=>e.style.display=isTeacher?'block':'none');
    document.querySelectorAll('.student-only').forEach(e=>e.style.display=isTeacher?'none':'block');
  }

  function bindButtons(){
    const t=document.getElementById('btn-teacher');
    const p=document.getElementById('btn-print');
    if(t) t.addEventListener('click', openAuthModal);
    if(p) p.addEventListener('click', ()=>window.print());
  }

  function openAuthModal(){
    ensureModal();
    const modal=document.getElementById('pwd-modal');
    const input=modal.querySelector('#pwd-input');
    const okBtn=modal.querySelector('.ok');
    const cancelBtn=modal.querySelector('.cancel');
    modal.style.display='flex';
    input.value=''; input.focus();
    const close=()=>modal.style.display='none';

    async function verify(){
      const val=input.value.trim();
      try{
        const hex = await sha256Hex(val);
        if(hex===TEACHER_HASH){ setAuthed(true); setView('teacher'); close(); return; }
      }catch(e){}
      alert('密码不正确');
      setAuthed(false); setView('student'); close();
    }
    okBtn.onclick=verify;
    cancelBtn.onclick=()=>{ setAuthed(false); setView('student'); close(); };
    input.onkeydown=(e)=>{ if(e.key==='Enter')verify(); if(e.key==='Escape')close(); };
  }

  function injectGlobalNavButtons(){
    // 防止重复注入
    if(document.getElementById("global-nav-buttons")) return;

    const box = document.createElement("div");
    box.id = "global-nav-buttons";
    box.innerHTML = `
      <button class="nav-btn" id="btn-back">← 上一页</button>
      <button class="nav-btn" id="btn-home">🏠 主页面</button>
    `;
    document.body.appendChild(box);

    document.getElementById("btn-back").onclick = ()=>history.back();
    document.getElementById("btn-home").onclick = ()=>window.location.href = "../../index.html";
  }

  function init(){
    if(authed()) setView('teacher'); else setView('student');
    bindButtons();
    injectGlobalNavButtons();   // ← 新增：全站统一按钮
  }

  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();
})();