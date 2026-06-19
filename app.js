/* Collage — a zero-dependency, client-side collage maker.
   Everything (layout + export) is rendered through one canvas draw routine,
   so the downloaded file is pixel-identical to the on-screen preview. */
(() => {
  "use strict";

  // ----- ISO 216 paper sizes in millimetres (all share the 1:√2 ratio) -----
  const SIZES = {
    A3: { w: 297, h: 420 },
    A4: { w: 210, h: 297 },
    A5: { w: 148, h: 210 },
  };

  const state = {
    size: "A4",
    orientation: "portrait",   // 'portrait' | 'landscape'
    marginMm: 5,
    gapMm: 3,
    radiusMm: 0,
    bg: "#ffffff",
    format: "png",
    dpi: 300,
    targetCols: 0,             // 0 = auto
    images: [],                // { id, img, w, h, url, zoom, offX, offY }
    rows: [],                  // [{ h, items: [{ w, imgIndex }] }]
    _layout: null,
  };

  // ----- element refs -----
  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  const overlay = $("overlay");
  const canvasWrap = $("canvasWrap");
  const stage = $("stage");
  const tray = $("tray");
  const fileInput = $("fileInput");
  const toastEl = $("toast");

  let uid = 0;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ================= geometry =================
  function pageMm() {
    const s = SIZES[state.size];
    return state.orientation === "portrait" ? { w: s.w, h: s.h } : { w: s.h, h: s.w };
  }
  function pageAspect() { const p = pageMm(); return p.w / p.h; }

  // pick a column count that makes cells as square-ish as possible for the page
  function bestCols(n, aspect) {
    let best = 1, score = Infinity;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const cellAspect = (aspect / c) / (1 / r);          // (pageW/c) / (pageH/r)
      const s = Math.abs(Math.log(cellAspect)) + 0.16 * (r * c - n); // +penalty for empty slots
      if (s < score - 1e-9) { score = s; best = c; }
    }
    return best;
  }

  // (re)build the row/column structure from the current image list
  function relayout() {
    const n = state.images.length;
    state.rows = [];
    if (!n) return;
    const cols = state.targetCols > 0 ? Math.min(state.targetCols, n) : bestCols(n, pageAspect());
    const numRows = Math.ceil(n / cols);
    let idx = 0;
    for (let r = 0; r < numRows; r++) {
      const remaining = n - idx;
      const thisCols = Math.min(cols, remaining);
      const items = [];
      for (let c = 0; c < thisCols; c++) items.push({ w: 1, imgIndex: idx++ });
      state.rows.push({ h: 1, items });
    }
  }

  // turn the structure into concrete pixel rectangles for a W×H canvas
  function computeLayout(W, H) {
    const pm = pageMm();
    const k = W / pm.w;                       // pixels per millimetre
    const margin = state.marginMm * k;
    const gap = state.gapMm * k;
    const radius = state.radiusMm * k;
    const x0 = margin, y0 = margin;
    const cw = Math.max(0, W - 2 * margin);
    const ch = Math.max(0, H - 2 * margin);

    const cells = [], vdiv = [], hdiv = [], grid = [];
    const rows = state.rows;
    const nR = rows.length;
    const sumH = rows.reduce((a, r) => a + r.h, 0) || 1;
    const innerH = Math.max(0, ch - gap * (nR - 1));

    let y = y0;
    for (let i = 0; i < nR; i++) {
      const row = rows[i];
      const rh = innerH * (row.h / sumH);
      const items = row.items;
      const nI = items.length;
      const sumW = items.reduce((a, it) => a + it.w, 0) || 1;
      const innerW = Math.max(0, cw - gap * (nI - 1));
      const gridRow = [];
      let x = x0;
      for (let j = 0; j < nI; j++) {
        const iw = innerW * (items[j].w / sumW);
        const cell = { x, y, w: iw, h: rh, image: state.images[items[j].imgIndex] || null };
        cells.push(cell);
        gridRow.push(cell);
        if (j < nI - 1) vdiv.push({ x: x + iw + gap / 2, y, h: rh, rowI: i, j });
        x += iw + gap;
      }
      grid.push(gridRow);
      if (i < nR - 1) hdiv.push({ x: x0, y: y + rh + gap / 2, w: cw, rowI: i });
      y += rh + gap;
    }
    return { cells, vdiv, hdiv, grid, margin, gap, radius, k, W, H };
  }

  // ================= drawing =================
  function roundRectPath(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, r); return; }
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawImageCover(c, image, dx, dy, dw, dh, radius) {
    if (dw <= 0 || dh <= 0) return;
    const s0 = Math.max(dw / image.w, dh / image.h);
    const s = s0 * image.zoom;
    const sw = dw / s, sh = dh / s;
    const rangeX = image.w * s - dw, rangeY = image.h * s - dh; // overflow in dest px
    const ox = rangeX > 0 ? rangeX * image.offX : 0;
    const oy = rangeY > 0 ? rangeY * image.offY : 0;
    let sx = ox / s, sy = oy / s;
    sx = clamp(sx, 0, Math.max(0, image.w - sw));
    sy = clamp(sy, 0, Math.max(0, image.h - sh));
    if (radius > 0) {
      c.save();
      roundRectPath(c, dx, dy, dw, dh, radius);
      c.clip();
      c.drawImage(image.img, sx, sy, sw, sh, dx, dy, dw, dh);
      c.restore();
    } else {
      c.drawImage(image.img, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  }

  function drawScene(c, layout, W, H) {
    c.clearRect(0, 0, W, H);
    c.fillStyle = state.bg;
    c.fillRect(0, 0, W, H);
    for (const cell of layout.cells) {
      if (cell.image && cell.image.img) drawImageCover(c, cell.image, cell.x, cell.y, cell.w, cell.h, layout.radius);
    }
  }

  // ================= preview render =================
  function previewSize() {
    const pad = 0;
    const availW = stage.clientWidth - 48;
    const availH = stage.clientHeight - 48;
    const aspect = pageAspect();
    let w = availW, h = availW / aspect;
    if (h > availH) { h = availH; w = availH * aspect; }
    return { w: Math.max(40, Math.floor(w)), h: Math.max(40, Math.floor(h)) };
  }

  function draw() {
    const { w: W, h: H } = previewSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const layout = computeLayout(W, H);
    state._layout = layout;
    drawScene(ctx, layout, W, H);

    canvasWrap.classList.toggle("empty", state.images.length === 0);
  }

  // divider handles live in a DOM overlay so they get nice resize cursors
  let vHandles = [], hHandles = [];
  function buildOverlay() {
    overlay.innerHTML = "";
    vHandles = []; hHandles = [];
    const L = state._layout;
    if (!L) return;
    const HW = Math.max(L.gap, 14);
    for (const d of L.vdiv) {
      const el = document.createElement("div");
      el.className = "handle v";
      styleV(el, d, HW);
      el.addEventListener("pointerdown", (e) => startDivider(e, "v", d, el));
      overlay.appendChild(el);
      vHandles.push(el);
    }
    const HH = Math.max(L.gap, 14);
    for (const d of L.hdiv) {
      const el = document.createElement("div");
      el.className = "handle h";
      styleH(el, d, HH);
      el.addEventListener("pointerdown", (e) => startDivider(e, "h", d, el));
      overlay.appendChild(el);
      hHandles.push(el);
    }
  }
  function styleV(el, d, HW) {
    el.style.left = (d.x - HW / 2) + "px";
    el.style.top = d.y + "px";
    el.style.width = HW + "px";
    el.style.height = d.h + "px";
  }
  function styleH(el, d, HH) {
    el.style.left = d.x + "px";
    el.style.top = (d.y - HH / 2) + "px";
    el.style.width = d.w + "px";
    el.style.height = HH + "px";
  }
  function repositionHandles() {
    const L = state._layout;
    if (!L) return;
    const HW = Math.max(L.gap, 14), HH = Math.max(L.gap, 14);
    L.vdiv.forEach((d, i) => vHandles[i] && styleV(vHandles[i], d, HW));
    L.hdiv.forEach((d, i) => hHandles[i] && styleH(hHandles[i], d, HH));
  }

  function render() { draw(); buildOverlay(); updateDims(); }

  // ================= divider dragging =================
  let divDrag = null;
  function startDivider(e, type, d, el) {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvas.getBoundingClientRect();
    const grid = state._layout.grid;
    const gap = state._layout.gap;
    el.classList.add("active");
    if (type === "v") {
      const a = grid[d.rowI][d.j], b = grid[d.rowI][d.j + 1];
      divDrag = { type, rowI: d.rowI, j: d.j, gap, rect, el, lo: a.x, hi: b.x + b.w };
    } else {
      const a = grid[d.rowI][0], b = grid[d.rowI + 1][0];
      divDrag = { type, rowI: d.rowI, gap, rect, el, lo: a.y, hi: b.y + b.h };
    }
    el.setPointerCapture(e.pointerId);
  }

  function moveDivider(e) {
    const D = divDrag;
    const MIN = 26;
    const totalInner = (D.hi - D.lo) - D.gap;
    if (totalInner < 2 * MIN) return;
    if (D.type === "v") {
      const px = e.clientX - D.rect.left;
      let leftW = clamp((px - D.gap / 2) - D.lo, MIN, totalInner - MIN);
      const it = state.rows[D.rowI].items;
      const combined = it[D.j].w + it[D.j + 1].w;
      const ratio = leftW / totalInner;
      it[D.j].w = combined * ratio;
      it[D.j + 1].w = combined * (1 - ratio);
    } else {
      const py = e.clientY - D.rect.top;
      let topH = clamp((py - D.gap / 2) - D.lo, MIN, totalInner - MIN);
      const r = state.rows;
      const combined = r[D.rowI].h + r[D.rowI + 1].h;
      const ratio = topH / totalInner;
      r[D.rowI].h = combined * ratio;
      r[D.rowI + 1].h = combined * (1 - ratio);
    }
    draw();
    repositionHandles();
  }

  // ================= pan / zoom inside a cell =================
  let pan = null;
  function cellAt(px, py) {
    const L = state._layout;
    if (!L) return null;
    for (const cell of L.cells) {
      if (px >= cell.x && px <= cell.x + cell.w && py >= cell.y && py <= cell.y + cell.h) return cell;
    }
    return null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.images.length) { openFile(); return; }
    const cell = cellAt(e.offsetX, e.offsetY);
    if (!cell || !cell.image) return;
    canvas.setPointerCapture(e.pointerId);
    pan = { image: cell.image, dw: cell.w, dh: cell.h, sx: e.clientX, sy: e.clientY, ox: cell.image.offX, oy: cell.image.offY };
    canvas.style.cursor = "grabbing";
  });

  window.addEventListener("pointermove", (e) => {
    if (divDrag) { moveDivider(e); return; }
    if (pan) {
      const img = pan.image;
      const s0 = Math.max(pan.dw / img.w, pan.dh / img.h);
      const s = s0 * img.zoom;
      const rangeX = img.w * s - pan.dw, rangeY = img.h * s - pan.dh;
      if (rangeX > 0.5) img.offX = clamp(pan.ox - (e.clientX - pan.sx) / rangeX, 0, 1);
      if (rangeY > 0.5) img.offY = clamp(pan.oy - (e.clientY - pan.sy) / rangeY, 0, 1);
      draw();
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (divDrag) { divDrag.el.classList.remove("active"); try { divDrag.el.releasePointerCapture(e.pointerId); } catch (_) {} divDrag = null; }
    if (pan) { pan = null; canvas.style.cursor = "grab"; }
  });

  canvas.addEventListener("wheel", (e) => {
    if (!state.images.length) return;
    const cell = cellAt(e.offsetX, e.offsetY);
    if (!cell || !cell.image) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    cell.image.zoom = clamp(cell.image.zoom * factor, 1, 6);
    draw();
  }, { passive: false });

  canvas.addEventListener("dblclick", (e) => {
    const cell = cellAt(e.offsetX, e.offsetY);
    if (cell && cell.image) { cell.image.zoom = 1; cell.image.offX = 0.5; cell.image.offY = 0.5; draw(); }
  });

  // ================= images =================
  function openFile() { fileInput.click(); }

  async function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    toast(`Loading ${files.length} image${files.length > 1 ? "s" : ""}…`);
    const loaded = await Promise.all(files.map((file) => new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ id: ++uid, img, w: img.naturalWidth, h: img.naturalHeight, url, zoom: 1, offX: 0.5, offY: 0.5 });
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    })));
    for (const it of loaded) if (it) state.images.push(it);
    relayout();
    render();
    renderTray();
    hideToast();
  }

  function removeImage(id) {
    const i = state.images.findIndex((im) => im.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(state.images[i].url);
    state.images.splice(i, 1);
    relayout();
    render();
    renderTray();
  }

  function clearAll() {
    if (!state.images.length) return;
    state.images.forEach((im) => URL.revokeObjectURL(im.url));
    state.images = [];
    state.rows = [];
    render();
    renderTray();
  }

  function shuffle() {
    for (let i = state.images.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.images[i], state.images[j]] = [state.images[j], state.images[i]];
    }
    relayout(); render(); renderTray();
  }

  // ================= tray (order + remove, drag to reorder) =================
  let dragSrc = null;
  function renderTray() {
    tray.innerHTML = "";
    state.images.forEach((im, i) => {
      const el = document.createElement("div");
      el.className = "thumb";
      el.draggable = true;
      el.dataset.id = im.id;
      el.innerHTML = `<img src="${im.url}" alt=""><span class="idx">${i + 1}</span><button class="remove" title="Remove">✕</button>`;
      el.querySelector(".remove").addEventListener("click", (e) => { e.stopPropagation(); removeImage(im.id); });

      el.addEventListener("dragstart", () => { dragSrc = im.id; el.classList.add("dragging"); });
      el.addEventListener("dragend", () => { dragSrc = null; el.classList.remove("dragging"); tray.querySelectorAll(".thumb").forEach((t) => t.classList.remove("drop-target")); });
      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop-target"); });
      el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("drop-target");
        if (dragSrc == null || dragSrc === im.id) return;
        const from = state.images.findIndex((x) => x.id === dragSrc);
        const to = state.images.findIndex((x) => x.id === im.id);
        if (from < 0 || to < 0) return;
        const [moved] = state.images.splice(from, 1);
        state.images.splice(to, 0, moved);
        relayout(); render(); renderTray();
      });

      tray.appendChild(el);
    });
    $("count").textContent = `${state.images.length} photo${state.images.length === 1 ? "" : "s"}`;
    $("downloadBtn").disabled = state.images.length === 0;
  }

  // ================= export =================
  function exportImage() {
    if (!state.images.length) return;
    const pm = pageMm();
    const W = Math.round((pm.w / 25.4) * state.dpi);
    const H = Math.round((pm.h / 25.4) * state.dpi);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    const layout = computeLayout(W, H);
    drawScene(cx, layout, W, H);

    const isJpg = state.format === "jpg";
    const type = isJpg ? "image/jpeg" : "image/png";
    const ext = isJpg ? "jpg" : "png";
    toast("Rendering…");
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `collage-${state.size}-${state.orientation}-${W}x${H}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      hideToast();
    }, type, 0.95);
  }

  // ================= misc UI =================
  function updateDims() {
    const pm = pageMm();
    const W = Math.round((pm.w / 25.4) * state.dpi);
    const H = Math.round((pm.h / 25.4) * state.dpi);
    $("dimsText").textContent = `${W} × ${H} px · ${state.size} ${state.orientation} · ${state.dpi} DPI`;
  }

  let toastTimer = null;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer); }
  function hideToast() { toastTimer = setTimeout(() => { toastEl.hidden = true; }, 600); }

  // ================= events =================
  $("sizeSelect").addEventListener("change", (e) => { state.size = e.target.value; relayout(); render(); });
  $("orientBtn").addEventListener("click", (e) => {
    state.orientation = state.orientation === "portrait" ? "landscape" : "portrait";
    e.target.textContent = state.orientation === "portrait" ? "↕ Portrait" : "↔ Landscape";
    relayout(); render();
  });
  $("colsSelect").addEventListener("change", (e) => { state.targetCols = parseInt(e.target.value, 10); relayout(); render(); });

  bindRange("gapRange", "gapVal", "gapMm", " mm");
  bindRange("marginRange", "marginVal", "marginMm", " mm");
  bindRange("radiusRange", "radiusVal", "radiusMm", " mm");
  function bindRange(rangeId, labelId, key, suffix) {
    const r = $(rangeId);
    r.addEventListener("input", () => {
      state[key] = parseFloat(r.value);
      $(labelId).textContent = r.value + suffix;
      render();
    });
  }

  $("dpiSelect").addEventListener("change", (e) => { state.dpi = parseInt(e.target.value, 10); updateDims(); });
  $("formatSelect").addEventListener("change", (e) => { state.format = e.target.value; });
  $("downloadBtn").addEventListener("click", exportImage);
  $("addBtn").addEventListener("click", openFile);
  $("shuffleBtn").addEventListener("click", shuffle);
  $("reverseBtn").addEventListener("click", () => { state.images.reverse(); relayout(); render(); renderTray(); });
  $("clearBtn").addEventListener("click", clearAll);
  fileInput.addEventListener("change", (e) => { addFiles(e.target.files); fileInput.value = ""; });

  // colour swatches
  function selectSwatch(color) {
    state.bg = color;
    document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("selected", s.dataset.color === color));
    draw();
  }
  document.querySelectorAll(".swatch[data-color]").forEach((s) => s.addEventListener("click", () => selectSwatch(s.dataset.color)));
  $("bgColor").addEventListener("input", (e) => {
    state.bg = e.target.value;
    document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
    draw();
  });
  selectSwatch("#ffffff");

  // drag & drop files anywhere
  ["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); }));
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  // keep preview fitted to the stage
  const ro = new ResizeObserver(() => render());
  ro.observe(stage);

  // first paint
  render();
  renderTray();
})();
