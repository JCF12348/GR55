class CropManager {
  constructor(canvas, ctx, paintManager = null) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.paintManager = paintManager;
    this.originalImage = null;
    this.imageScale = 1;
    this.imageOffsetX = 0;
    this.imageOffsetY = 0;
    this.currentRotation = 0;
    this.minScale = 0.1;
    this.maxScale = 5;
    this.isPanning = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.lastTouchDistance = 0;
    this.renderCallback = null;
    this.loadVersion = 0;
    this.animationFrame = 0;
    this.commitTimer = 0;
    this.interactiveDirty = false;

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
  }

  setRenderCallback(callback) {
    this.renderCallback = typeof callback === 'function' ? callback : null;
  }

  hasImage() {
    return this.originalImage !== null;
  }

  canTransform() {
    if (!this.originalImage) return false;
    if (!this.paintManager) return true;
    if (this.paintManager.currentTool) return false;
    return !this.paintManager.hasOverlayElements || !this.paintManager.hasOverlayElements();
  }

  resetStates() {
    this.imageScale = 1;
    this.imageOffsetX = 0;
    this.imageOffsetY = 0;
    this.currentRotation = 0;
    this.isPanning = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.lastTouchDistance = 0;
  }

  setControlsEnabled(enabled) {
    ['rotate-left', 'rotate-right', 'zoom-out-image', 'zoom-in-image', 'reset-transform'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = !enabled;
    });
  }

  refreshInteractionState() {
    const enabled = this.canTransform();
    const hasOverlays = this.paintManager && this.paintManager.hasOverlayElements &&
      this.paintManager.hasOverlayElements();
    this.canvas.parentNode.classList.toggle('image-transform-locked', this.hasImage() && !enabled);
    // Transform buttons remain available while an empty editing tool is active;
    // clicking one exits that tool first. Existing overlays stay protected.
    this.setControlsEnabled(this.hasImage() && !hasOverlays);
  }

  prepareTransform() {
    if (this.paintManager && this.paintManager.currentTool) {
      this.paintManager.setActiveTool(null, '');
    }
    return this.canTransform();
  }

  loadFile(file) {
    if (!file) return Promise.resolve(false);
    const loadVersion = ++this.loadVersion;

    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        if (loadVersion !== this.loadVersion) {
          resolve(false);
          return;
        }
        try {
          this.originalImage = image;
          this.canvas.parentNode.classList.add('image-transform-mode');
          this.refreshInteractionState();
          this.resetTransform(true);
          resolve(true);
        } catch (error) {
          this.clearImage();
          reject(error);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        if (loadVersion !== this.loadVersion) {
          resolve(false);
          return;
        }
        reject(new Error('图片文件无法读取'));
      };
      image.src = objectUrl;
    });
  }

  clearImage() {
    this.loadVersion++;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.animationFrame = 0;
    this.commitTimer = 0;
    this.interactiveDirty = false;
    this.originalImage = null;
    this.resetStates();
    this.canvas.classList.remove('grabbing');
    this.canvas.parentNode.classList.remove('image-transform-mode');
    this.canvas.parentNode.classList.remove('image-transform-locked');
    this.setControlsEnabled(false);
  }

  resetTransform(commitHistory = true) {
    if (!this.originalImage) return false;
    this.imageScale = Math.min(
      this.maxScale,
      Math.max(
        this.minScale,
        Math.max(
          this.canvas.width / this.originalImage.width,
          this.canvas.height / this.originalImage.height
        )
      )
    );
    this.imageOffsetX = 0;
    this.imageOffsetY = 0;
    this.currentRotation = 0;
    this.redraw(commitHistory);
    return true;
  }

  rotateImage(degrees) {
    if (!this.canTransform()) return false;
    this.currentRotation = (this.currentRotation + degrees) % 360;
    this.redraw(true);
    return true;
  }

  zoomImage(factor, commitHistory = false) {
    if (!this.canTransform()) return false;
    const nextScale = Math.max(this.minScale, Math.min(this.maxScale, this.imageScale * factor));
    if (Math.abs(nextScale - this.imageScale) < 0.0001) return false;
    this.imageScale = nextScale;
    if (commitHistory) this.redraw(true);
    else this.queueInteractiveRedraw();
    return true;
  }

  drawTransformedImage() {
    if (!this.originalImage) return;

    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    this.ctx.rotate(this.currentRotation * Math.PI / 180);
    const width = this.originalImage.width * this.imageScale;
    const height = this.originalImage.height * this.imageScale;
    this.ctx.drawImage(
      this.originalImage,
      -width / 2 + this.imageOffsetX,
      -height / 2 + this.imageOffsetY,
      width,
      height
    );
    this.ctx.restore();
  }

  redraw(commitHistory = false) {
    if (!this.originalImage) return;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.animationFrame = 0;
    this.commitTimer = 0;
    this.interactiveDirty = false;

    this.drawTransformedImage();
    const sourceImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    if (this.renderCallback) this.renderCallback(sourceImageData, commitHistory);
  }

  queueInteractiveRedraw() {
    if (!this.originalImage) return;
    this.interactiveDirty = true;
    if (this.animationFrame) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = 0;
      this.drawTransformedImage();
      // Render the transformed source through the same preview pipeline used
      // after a committed transform, without adding a history entry per frame.
      if (this.renderCallback) {
        const sourceImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.renderCallback(sourceImageData, false);
      }
    });
  }

  scheduleTransformCommit() {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => {
      this.commitTimer = 0;
      this.commitPendingTransform(true);
    }, 90);
  }

  commitPendingTransform(commitHistory = false) {
    if (!this.originalImage || !this.interactiveDirty) return false;
    this.redraw(commitHistory);
    return true;
  }

  getCanvasDelta(deltaX, deltaY) {
    const rect = this.canvas.getBoundingClientRect();
    const scaledX = rect.width > 0 ? deltaX * this.canvas.width / rect.width : deltaX;
    const scaledY = rect.height > 0 ? deltaY * this.canvas.height / rect.height : deltaY;
    const radians = this.currentRotation * Math.PI / 180;
    return {
      x: scaledX * Math.cos(radians) + scaledY * Math.sin(radians),
      y: -scaledX * Math.sin(radians) + scaledY * Math.cos(radians)
    };
  }

  beginPan(clientX, clientY) {
    if (!this.canTransform()) return false;
    this.isPanning = true;
    this.lastPointerX = clientX;
    this.lastPointerY = clientY;
    this.canvas.classList.add('grabbing');
    return true;
  }

  movePan(clientX, clientY) {
    if (!this.isPanning || !this.canTransform()) return;
    const delta = this.getCanvasDelta(clientX - this.lastPointerX, clientY - this.lastPointerY);
    this.imageOffsetX += delta.x;
    this.imageOffsetY += delta.y;
    this.lastPointerX = clientX;
    this.lastPointerY = clientY;
    this.queueInteractiveRedraw();
  }

  endPan(commitHistory = true) {
    if (!this.isPanning) return;
    this.isPanning = false;
    this.lastTouchDistance = 0;
    this.canvas.classList.remove('grabbing');
    if (commitHistory && this.originalImage) this.redraw(true);
  }

  handleMouseDown(event) {
    if (event.button !== 0 || !this.beginPan(event.clientX, event.clientY)) return;
    event.preventDefault();
  }

  handleMouseMove(event) {
    this.movePan(event.clientX, event.clientY);
  }

  handleMouseUp() {
    this.endPan(true);
  }

  handleWheel(event) {
    if (!this.canTransform()) return;
    event.preventDefault();
    if (this.zoomImage(event.deltaY > 0 ? 0.97 : 1.03, false)) {
      this.scheduleTransformCommit();
    }
  }

  getTouchDistance(touches) {
    const deltaX = touches[0].clientX - touches[1].clientX;
    const deltaY = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  }

  handleTouchStart(event) {
    if (!this.canTransform()) return;
    event.preventDefault();
    if (event.touches.length === 1) {
      this.beginPan(event.touches[0].clientX, event.touches[0].clientY);
    } else if (event.touches.length === 2) {
      this.endPan(false);
      this.lastTouchDistance = this.getTouchDistance(event.touches);
    }
  }

  handleTouchMove(event) {
    if (!this.canTransform()) return;
    event.preventDefault();
    if (event.touches.length === 1 && this.isPanning) {
      this.movePan(event.touches[0].clientX, event.touches[0].clientY);
    } else if (event.touches.length === 2) {
      const nextDistance = this.getTouchDistance(event.touches);
      if (this.lastTouchDistance > 0) {
        this.zoomImage(nextDistance / this.lastTouchDistance, false);
      }
      this.lastTouchDistance = nextDistance;
    }
  }

  handleTouchEnd(event) {
    if (!this.originalImage) return;
    if (event.touches.length === 1) {
      this.lastTouchDistance = 0;
      this.beginPan(event.touches[0].clientX, event.touches[0].clientY);
      return;
    }
    const wasPinching = this.lastTouchDistance > 0;
    this.endPan(true);
    if (wasPinching) {
      this.lastTouchDistance = 0;
      this.redraw(true);
    }
  }

  initCropTools() {
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });

    const rotateLeft = document.getElementById('rotate-left');
    const rotateRight = document.getElementById('rotate-right');
    const zoomOut = document.getElementById('zoom-out-image');
    const zoomIn = document.getElementById('zoom-in-image');
    const resetTransform = document.getElementById('reset-transform');
    if (rotateLeft) rotateLeft.addEventListener('click', () => {
      if (this.prepareTransform()) this.rotateImage(-90);
    });
    if (rotateRight) rotateRight.addEventListener('click', () => {
      if (this.prepareTransform()) this.rotateImage(90);
    });
    if (zoomOut) zoomOut.onclick = (event) => {
      event.preventDefault();
      if (this.prepareTransform()) this.zoomImage(0.99, true);
    };
    if (zoomIn) zoomIn.onclick = (event) => {
      event.preventDefault();
      if (this.prepareTransform()) this.zoomImage(1.01, true);
    };
    if (resetTransform) resetTransform.addEventListener('click', () => {
      if (this.prepareTransform()) this.resetTransform(true);
    });
    this.setControlsEnabled(false);
  }
}
