(function () {
  'use strict';
  var state = { images: [], layout: 'four-grid', selected: 0, drag: null, raf: 0, loading: false };

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败：' + file.name)); };
      image.src = url;
    });
  }

  function canvasAndContext() { var canvas = document.getElementById('canvas'); return canvas ? { canvas: canvas, ctx: canvas.getContext('2d') } : null; }
  function requiredCount() {
    if (state.layout === 'four-grid') return 4;
    if (state.layout === 'three-horizontal' || state.layout === 'three-vertical') return 3;
    if (state.layout === 'six-grid') return 6;
    if (state.layout === 'nine-grid') return 9;
    return 2;
  }
  function cells(width, height) {
    if (state.layout === 'left-right') return [[0, 0, width / 2, height], [width / 2, 0, width / 2, height]];
    if (state.layout === 'top-bottom') return [[0, 0, width, height / 2], [0, height / 2, width, height / 2]];
    if (state.layout === 'four-grid') return [[0, 0, width / 2, height / 2], [width / 2, 0, width / 2, height / 2], [0, height / 2, width / 2, height / 2], [width / 2, height / 2, width / 2, height / 2]];
    if (state.layout === 'three-horizontal') return [[0, 0, width / 3, height], [width / 3, 0, width / 3, height], [width * 2 / 3, 0, width / 3, height]];
    if (state.layout === 'three-vertical') return [[0, 0, width, height / 3], [0, height / 3, width, height / 3], [0, height * 2 / 3, width, height / 3]];
    if (state.layout === 'six-grid') return [[0, 0, width / 3, height / 2], [width / 3, 0, width / 3, height / 2], [width * 2 / 3, 0, width / 3, height / 2], [0, height / 2, width / 3, height / 2], [width / 3, height / 2, width / 3, height / 2], [width * 2 / 3, height / 2, width / 3, height / 2]];
    if (state.layout === 'nine-grid') { var grid = []; for (var row = 0; row < 3; row++) for (var col = 0; col < 3; col++) grid.push([col * width / 3, row * height / 3, width / 3, height / 3]); return grid; }
    return [[0, 0, width, height], [0, 0, width, height]];
  }
  function fitScale(image, cell) { return Math.max(cell[2] / image.width, cell[3] / image.height); }
  function drawImageInCell(ctx, item, cell) {
    var scale = fitScale(item.image, cell) * item.scale, width = item.image.width * scale, height = item.image.height * scale;
    var x = cell[0] + (cell[2] - width) / 2 + item.dx, y = cell[1] + (cell[3] - height) / 2 + item.dy;
    ctx.drawImage(item.image, x, y, width, height);
  }
  function clipCell(ctx, cell, index, width, height) {
    ctx.beginPath();
    if (state.layout !== 'diagonal') { ctx.rect(cell[0], cell[1], cell[2], cell[3]); return; }
    if (index === 0) { ctx.moveTo(0, 0); ctx.lineTo(width, 0); ctx.lineTo(0, height); }
    else { ctx.moveTo(width, 0); ctx.lineTo(width, height); ctx.lineTo(0, height); }
    ctx.closePath();
  }
  function rawRender() {
    var ref = canvasAndContext(); if (!ref || !state.images.length) return;
    var canvas = ref.canvas, ctx = ref.ctx, w = canvas.width, h = canvas.height, layoutCells = cells(w, h);
    ctx.save(); ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    state.images.forEach(function (item, index) { var cell = layoutCells[index]; if (!cell) return; ctx.save(); clipCell(ctx, cell, index, w, h); ctx.clip(); drawImageInCell(ctx, item, cell); ctx.restore(); });
    ctx.restore();
  }
  function ditherPreview() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(function () {
      state.raf = 0;
      if (typeof window.resetDitherPreviewState === 'function') window.resetDitherPreviewState();
      var checkbox = document.getElementById('collageDitherPreview');
      if (checkbox && checkbox.checked) {
        if (typeof window.applyDither === 'function') window.applyDither();
      }
    });
  }
  function render(commit) {
    rawRender(); ditherPreview();
    if (commit && typeof paintManager !== 'undefined' && paintManager) {
      if (typeof paintManager.setBaseImageData === 'function') paintManager.setBaseImageData();
      if (typeof paintManager.clearHistory === 'function') paintManager.clearHistory();
      if (typeof paintManager.saveToHistory === 'function') paintManager.saveToHistory();
    }
  }
  function hitTest(x, y) {
    var canvas = document.getElementById('canvas'), layoutCells = cells(canvas.width, canvas.height);
    if (state.layout === 'diagonal') return (x / canvas.width + y / canvas.height <= 1) ? 0 : 1;
    // A layout switch can leave more loaded images than the new layout uses
    // (for example, nine-grid -> four-grid). Only visible cells are draggable.
    var visibleCount = Math.min(state.images.length, layoutCells.length);
    for (var i = visibleCount - 1; i >= 0; i--) { var c = layoutCells[i]; if (x >= c[0] && x <= c[0] + c[2] && y >= c[1] && y <= c[1] + c[3]) return i; }
    return -1;
  }
  function pointerPosition(event, canvas) { var rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; }
  function installCanvasEditing() {
    var canvas = document.getElementById('canvas'); if (!canvas || canvas.dataset.collageEditing) return;
    canvas.dataset.collageEditing = '1';
    canvas.addEventListener('pointerdown', function (event) { if (!state.images.length) return; var p = pointerPosition(event, canvas), index = hitTest(p.x, p.y); if (index < 0) return; state.selected = index; state.drag = { x: p.x, y: p.y, lastX: p.x, lastY: p.y, dx: state.images[index].dx, dy: state.images[index].dy }; canvas.setPointerCapture(event.pointerId); event.preventDefault(); event.stopImmediatePropagation(); });
    canvas.addEventListener('pointermove', function (event) { if (!state.drag) return; var p = pointerPosition(event, canvas), item = state.images[state.selected]; state.drag.lastX = p.x; state.drag.lastY = p.y; item.dx = state.drag.dx + p.x - state.drag.x; item.dy = state.drag.dy + p.y - state.drag.y; render(false); updateSelectedLabel(); event.preventDefault(); event.stopImmediatePropagation(); });
    canvas.addEventListener('pointerup', function (event) {
      if (!state.drag) return;
      var from = state.selected, to = hitTest(state.drag.lastX, state.drag.lastY);
      state.drag = null;
      if (to >= 0 && to !== from && to < state.images.length) {
        var moving = state.images[from];
        state.images[from] = state.images[to];
        state.images[to] = moving;
        state.images[from].dx = 0; state.images[from].dy = 0;
        state.images[to].dx = 0; state.images[to].dy = 0;
        state.selected = to;
      }
      render(true); updateSelectedLabel(); event.stopImmediatePropagation();
    });
    canvas.addEventListener('pointercancel', function () { state.drag = null; });
    canvas.addEventListener('wheel', function (event) {
      if (!state.images.length) return;
      var p = pointerPosition(event, canvas), index = hitTest(p.x, p.y);
      if (index < 0) return;
      state.selected = index;
      var item = state.images[index], factor = event.deltaY < 0 ? 1.05 : 0.95;
      item.scale = Math.max(0.5, Math.min(2.5, item.scale * factor));
      updateSelectedLabel(); render(false); event.preventDefault(); event.stopImmediatePropagation();
    }, { passive: false });
  }
  function updateSelectedLabel() { var label = document.getElementById('collageSelected'); if (label) label.textContent = state.images.length ? ('当前图片 ' + (state.selected + 1) + '：拖动移动，拖到其他区域可交换，滚轮缩放') : '选择图片后可拖动，拖到其他区域可交换，滚轮缩放'; }
  function buildImageControls() { updateSelectedLabel(); }
  async function previewFromFiles() {
    var input = document.getElementById('collageFiles'), layoutNode = document.getElementById('collageLayout'); if (!input) return;
    state.layout = layoutNode ? layoutNode.value : state.layout; var files = Array.prototype.slice.call(input.files || []), need = requiredCount();
    if (files.length < need) { if (typeof addLog === 'function') addLog('当前布局需要至少 ' + need + ' 张图片'); return; }
    state.loading = true;
    try {
      // Keep every selected image in memory. The current layout only renders
      // its required number of cells, so switching from the default four-grid
      // to six/nine-grid can reveal the remaining images immediately.
      var images = await Promise.all(files.map(loadImage));
      state.images = images.map(function (image) { return { image: image, scale: 1, dx: 0, dy: 0 }; });
      state.selected = 0;
      buildImageControls(); updateSelectedLabel(); render(false);
    } catch (error) { if (typeof addLog === 'function') addLog('拼图预览失败：' + error.message); } finally { state.loading = false; }
  }
  window.previewCollage = previewFromFiles;
  window.applyCollage = function () { if (!state.images.length) return previewFromFiles(); render(true); if (typeof addLog === 'function') addLog('拼图完成，可继续抖动并发送'); };
  document.addEventListener('DOMContentLoaded', function () { installCanvasEditing(); var input = document.getElementById('collageFiles'), layout = document.getElementById('collageLayout'), dither = document.getElementById('collageDitherPreview'); if (input) input.addEventListener('change', previewFromFiles); if (layout) layout.addEventListener('change', function () { if (state.images.length) { state.layout = layout.value; state.selected = Math.min(state.selected, requiredCount() - 1, state.images.length - 1); buildImageControls(); render(false); } }); if (dither) dither.addEventListener('change', function () { if (state.images.length) render(false); }); });
}());
