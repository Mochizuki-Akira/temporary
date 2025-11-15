// ink.js — HIGH PERFORMANCE viewport canvas with two eraser modes (stroke / brush)
// Brush eraser fixed to create continuous erase strokes; erase only when pressed.
(function(){
  const LS_KEY = "inkpad:" + location.pathname;
  const DPR_CAP = 1.5; // cap device pixel ratio for performance
  const dpr = Math.min(DPR_CAP, Math.max(1, window.devicePixelRatio || 1));

  let active = false;
  let mode = 'pen';           // 'pen' | 'eraser'
  let eraserMode = 'stroke';  // 'stroke' | 'brush'
  let color = '#111111';
  let width = 3;
  let strokes = [];     // each {mode,color,width,points:[{x,y,p}], bbox:{minX,minY,maxX,maxY}}
  let redoStack = [];
  let drawing = false;        // pressed and in-progress drawing/erasing
  let pointerDown = false;    // pointer is currently pressed
  let currentEraseStroke = null; // for brush mode

  let canvas, ctx, panel, toggleBtn, widthInput;
  let rafId = 0, needsRedraw = true;
  const colors = ['#111111','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#0f172a'];

  function createUI(){
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'ink-toggle';
    toggleBtn.textContent = '手写';
    toggleBtn.addEventListener('click', ()=> setActive(!active));
    document.body.appendChild(toggleBtn);

    canvas = document.createElement('canvas');
    canvas.id = 'ink-canvas';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha:true });

    panel = document.createElement('div');
    panel.id = 'ink-panel';
    panel.innerHTML = `
      <button class="ink-btn" data-mode="pen">钢笔</button>
      <button class="ink-btn" data-mode="eraser">橡皮</button>
      <div class="ink-sep"></div>
      <div id="ink-eraser-modes" style="display:inline-flex; gap:6px;">
        <button class="ink-btn" data-eraser="stroke" title="整笔擦除">整笔</button>
        <button class="ink-btn" data-eraser="brush" title="涂抹擦除">涂抹</button>
      </div>
      <div class="ink-sep"></div>
      <div id="ink-colors"></div>
      <div class="ink-sep"></div>
      <label style="font-size:13px;color:#475569;">线宽 <input id="ink-width" type="range" min="1" max="20" value="3"></label>
      <div class="ink-sep"></div>
      <button class="ink-btn" id="ink-undo">撤销</button>
      <button class="ink-btn" id="ink-redo">重做</button>
      <button class="ink-btn" id="ink-clear">清空</button>
      <button class="ink-btn primary" id="ink-save">保存PNG</button>
      <button class="ink-btn" id="ink-exit">退出</button>
    `;
    document.body.appendChild(panel);

    // Colors
    const colorBox = panel.querySelector('#ink-colors');
    colors.forEach(c=>{
      const b = document.createElement('button');
      b.className = 'ink-color';
      b.style.background = c;
      b.dataset.color = c;
      b.addEventListener('click', ()=>{ color = c; updatePalette(); });
      colorBox.appendChild(b);
    });
    updatePalette();

    widthInput = panel.querySelector('#ink-width');
    widthInput.addEventListener('input', ()=>{ width = +widthInput.value || 3; });

    // Mode buttons
    const penBtn = panel.querySelector('[data-mode="pen"]');
    const eraserBtn = panel.querySelector('[data-mode="eraser"]');
    penBtn.addEventListener('click', ()=>{ mode='pen'; updateModeButtons(); });
    eraserBtn.addEventListener('click', ()=>{ mode='eraser'; updateModeButtons(); });

    // Eraser mode buttons
    panel.querySelectorAll('[data-eraser]').forEach(b=>{
      b.addEventListener('click', ()=>{ eraserMode = b.dataset.eraser; updateEraserButtons(); });
    });
    updateModeButtons();
    updateEraserButtons();

    // Actions
    panel.querySelector('#ink-undo').addEventListener('click', undo);
    panel.querySelector('#ink-redo').addEventListener('click', redo);
    panel.querySelector('#ink-clear').addEventListener('click', clearAll);
    panel.querySelector('#ink-save').addEventListener('click', savePNG);
    panel.querySelector('#ink-exit').addEventListener('click', ()=> setActive(false));

    // Events
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('scroll', requestRedraw, { passive:true });

    canvas.addEventListener('pointerdown', onDown, { passive:true });
    canvas.addEventListener('pointermove', onMove, { passive:true });
    window.addEventListener('pointerup', onUp, { passive:true });
    window.addEventListener('pointercancel', onUp, { passive:true });

    window.addEventListener('beforeprint', preparePrintBitmap);

    resizeCanvas();
    restore();
    updateCanvasVisibility();
    startRAF();
  }

  function updateModeButtons(){
    panel.querySelectorAll('[data-mode]').forEach(b=> b.classList.toggle('primary', b.dataset.mode===mode));
  }
  function updateEraserButtons(){
    panel.querySelectorAll('[data-eraser]').forEach(b=> b.classList.toggle('primary', b.dataset.eraser===eraserMode));
  }
  function updatePalette(){
    panel.querySelectorAll('.ink-color').forEach(b=>{
      b.classList.toggle('active', b.dataset.color===color);
    });
  }

  function resizeCanvas(){
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h){
      canvas.width = w; canvas.height = h;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      requestRedraw();
    }
  }

  function setActive(v){
    active = v;
    panel.classList.toggle('show', v);
    canvas.style.pointerEvents = v ? 'auto' : 'none';
    toggleBtn.textContent = v ? '退出手写' : '手写';
    updateCanvasVisibility();
  }
  function updateCanvasVisibility(){
    const hasInk = strokes && strokes.length > 0;
    canvas.style.display = (active || hasInk) ? 'block' : 'none';
  }

  // ----- geometry / hit test -----
  function updateBBox(stroke){
    const pts = stroke.points;
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const p of pts){
      if (p.x<minX) minX=p.x; if (p.y<minY) minY=p.y;
      if (p.x>maxX) maxX=p.x; if (p.y>maxY) maxY=p.y;
    }
    const pad = Math.max(2, stroke.width*2);
    stroke.bbox = {minX:minX-pad, minY:minY-pad, maxX:maxX+pad, maxY:maxY+pad};
  }
  function pointSegDist2(px, py, ax, ay, bx, by){
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const c1 = vx*wx + vy*wy;
    if (c1 <= 0) return wx*wx + wy*wy;
    const c2 = vx*vx + vy*vy;
    if (c2 <= c1) { const dx=px-bx, dy=py-by; return dx*dx + dy*dy; }
    const t = c1 / c2;
    const cx = ax + t*vx, cy = ay + t*vy;
    const dx = px - cx, dy = py - cy;
    return dx*dx + dy*dy;
  }
  function hitStroke(stroke, px, py, tol){
    const b = stroke.bbox;
    if (!b || px<b.minX || px>b.maxX || py<b.minY || py>b.maxY) return false;
    const pts = stroke.points;
    if (!pts || pts.length===0) return false;
    if (pts.length===1){
      const dx = px-pts[0].x, dy = py-pts[0].y;
      return (dx*dx+dy*dy) <= tol*tol;
    }
    for (let i=1;i<pts.length;i++){
      if (pointSegDist2(px,py, pts[i-1].x,pts[i-1].y, pts[i].x,pts[i].y) <= tol*tol) return true;
    }
    return false;
  }

  // ----- input helpers -----
  function pagePos(e){
    const ce = (e.getCoalescedEvents ? e.getCoalescedEvents() : null);
    if (ce && ce.length){
      const last = ce[ce.length-1];
      return { x: last.pageX, y: last.pageY, p: (last.pressure>0?last.pressure:0.5) };
    }
    return { x: e.pageX, y: e.pageY, p: (e.pressure>0?e.pressure:0.5) };
  }
  function visibleYRange(){
    const y0 = window.scrollY;
    const y1 = y0 + window.innerHeight;
    return [y0-40, y1+40];
  }

  // ----- pointer handlers -----
  function onDown(e){
    if (!active) return;
    pointerDown = true;
    const p = pagePos(e);
    if (mode === 'eraser'){
      if (eraserMode === 'stroke'){
        const tol = Math.max(6, width*2);
        let removed = false;
        for (let i=strokes.length-1; i>=0; i--){
          const s = strokes[i];
          if (!s.bbox) updateBBox(s);
          if (hitStroke(s, p.x, p.y, tol)){
            redoStack = [];
            strokes.splice(i,1);
            removed = true;
            break;
          }
        }
        drawing = true; // allow scrub-delete while pressed
        if (removed){ requestRedraw(); autosave(); updateCanvasVisibility(); }
        return;
      } else {
        // brush erase: start a continuous eraser stroke
        drawing = true;
        currentEraseStroke = {
          mode: 'eraser',
          color: '#000000',
          width: Math.max(8, width * 2),
          points: [p],
          bbox: null
        };
        updateBBox(currentEraseStroke);
        strokes.push(currentEraseStroke);
        requestRedraw();
        return;
      }
    }
    // pen mode
    drawing = true;
    redoStack = [];
    const stroke = { mode, color, width, points: [p], bbox: null };
    strokes.push(stroke);
    updateBBox(stroke);
    requestRedraw();
  }

  function onMove(e){
    if (!active) return;
    if (!pointerDown) return; // must be pressed to draw/erase
    const p = pagePos(e);

    if (mode === 'eraser'){
      if (!drawing) return;
      if (eraserMode === 'stroke'){
        const tol = Math.max(6, width*2);
        let erased = false;
        for (let i=strokes.length-1; i>=0; i--){
          const s = strokes[i];
          if (!s.bbox) updateBBox(s);
          if (hitStroke(s, p.x, p.y, tol)){
            strokes.splice(i,1);
            erased = true;
          }
        }
        if (erased){ redoStack=[]; requestRedraw(); autosave(); updateCanvasVisibility(); }
        return;
      } else {
        // brush: append to the same eraser stroke
        if (!currentEraseStroke) return;
        currentEraseStroke.points.push(p);
        const b = currentEraseStroke.bbox;
        if (b){
          if (p.x < b.minX) b.minX = p.x;
          if (p.y < b.minY) b.minY = p.y;
          if (p.x > b.maxX) b.maxX = p.x;
          if (p.y > b.maxY) b.maxY = p.y;
        }
        requestRedraw();
        return;
      }
    }

    if (!drawing) return;
    const s = strokes[strokes.length-1];
    s.points.push(p);
    if (!s.bbox) updateBBox(s);
    else{
      if (p.x < s.bbox.minX) s.bbox.minX = p.x;
      if (p.y < s.bbox.minY) s.bbox.minY = p.y;
      if (p.x > s.bbox.maxX) s.bbox.maxX = p.x;
      if (p.y > s.bbox.maxY) s.bbox.maxY = p.y;
    }
    requestRedraw();
  }

  function onUp(){
    if (!active) return;
    pointerDown = false;
    if (!drawing) return;
    drawing = false;
    currentEraseStroke = null; // finish brush stroke if any
    autosave();
    updateCanvasVisibility();
  }

  // ----- draw -----
  function requestRedraw(){
    needsRedraw = true;
    if (!rafId) rafId = requestAnimationFrame(drawFrame);
  }
  function startRAF(){ if (!rafId) rafId = requestAnimationFrame(drawFrame); }

  function drawFrame(){
    rafId = 0;
    if (!needsRedraw) return;
    needsRedraw = false;

    const [vy0, vy1] = visibleYRange();
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const offsetY = -window.scrollY;
    for (const s of strokes){
      if (!s.points || s.points.length===0) continue;
      const b = s.bbox || (updateBBox(s), s.bbox);
      if (b.maxY < vy0 || b.minY > vy1) continue;
      ctx.save();
      if (s.mode === 'eraser'){
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = s.width * 2;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
      }
      let started = false;
      for (let i=0;i<s.points.length;i++){
        const pt = s.points[i];
        const y = pt.y;
        if (y < vy0 || y > vy1){ started = false; continue; }
        const vx = pt.x;
        const vy = pt.y + offsetY;
        if (!started){ ctx.beginPath(); ctx.moveTo(vx, vy); started = true; }
        else { ctx.lineTo(vx, vy); }
      }
      if (started) ctx.stroke();
      ctx.restore();
    }
  }

  // ----- utils & persistence -----
  function undo(){ if (strokes.length){ redoStack.push(strokes.pop()); requestRedraw(); autosave(); updateCanvasVisibility(); } }
  function redo(){ if (redoStack.length){ strokes.push(redoStack.pop()); requestRedraw(); autosave(); updateCanvasVisibility(); } }
  function clearAll(){ if (confirm('清空当前批注？')){ strokes.length=0; redoStack.length=0; requestRedraw(); autosave(); updateCanvasVisibility(); } }

  function savePNG(){
    const pageW = document.documentElement.scrollWidth;
    const pageH = document.documentElement.scrollHeight;
    const dpr2 = Math.min(DPR_CAP, Math.max(1, window.devicePixelRatio||1));
    const off = document.createElement('canvas');
    off.width = Math.floor(pageW * dpr2);
    off.height = Math.floor(pageH * dpr2);
    const c = off.getContext('2d');
    c.setTransform(dpr2,0,0,dpr2,0,0);
    for (const s of strokes){
      if (!s.points || s.points.length<1) continue;
      c.save();
      if (s.mode==='eraser'){
        c.globalCompositeOperation='destination-out';
        c.lineWidth = s.width * 2;
      } else {
        c.globalCompositeOperation='source-over';
        c.strokeStyle=s.color;
        c.lineWidth=s.width;
      }
      c.beginPath();
      c.moveTo(s.points[0].x, s.points[0].y);
      for (let i=1;i<s.points.length;i++) c.lineTo(s.points[i].x, s.points[i].y);
      c.stroke();
      c.restore();
    }
    const url = off.toDataURL('image/png');
    const a = document.createElement('a'); a.href=url; a.download='ink-'+Date.now()+'.png'; a.click();
  }

  function preparePrintBitmap(){ requestRedraw(); }

  function autosave(){ try{ localStorage.setItem(LS_KEY, JSON.stringify({strokes})); }catch(e){} }
  function restore(){ try{ const s = localStorage.getItem(LS_KEY); if(!s) return; const d=JSON.parse(s); strokes=d.strokes||[]; requestRedraw(); }catch(e){} }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI); else createUI();
})();
