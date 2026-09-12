class PaintManager {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.painting = false;
    this.lastX = 0;
    this.lastY = 0;
    this.brushColor = "#000000";
    this.brushSize = 2;
    this.currentTool = null;
    this.textElements = [];
    this.lineSegments = [];
    this.isTextPlacementMode = false;
    this.draggingCanvasContext = null;
    this.selectedTextElement = null;
    this.isDraggingText = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.textBold = false;
    this.textItalic = false;
    this.todoItems = [];
    this.isTodoPlacementMode = false;
    this.selectedTodoItem = null;
    this.todoBold = false;
    this.todoItalic = false;
    this.todoColor = '#000000';
    this.showTodoDeleteButtons = true;

    this.scheduleData = null;
    this.scheduleDays = 5;
    this.scheduleClasses = 6;
    this.scheduleFontFamily = 'SimHei';
    this.scheduleFontSize = 12;
    this.scheduleColor = '#000000';
    this.scheduleStartX = 20;
    this.scheduleStartY = 20;
    this.scheduleCellWidth = 60;
    this.scheduleCellHeight = 35;
    this.weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    this.selectedScheduleCell = null;
    this.showScheduleCellIndicator = true;
    this.scheduleCellFontSizes = null;
    this.scheduleBaseImageData = null;
    this.matterTimeLimits = [];
    this.matterTodos = [];
    this.matterSchedules = [];
    this.matterTemplateRendered = false;

    // Brush cursor indicator
    this.brushCursor = null;

    // Undo/Redo functionality
    this.historyStack = [];
    this.historyStep = -1;
    this.MAX_HISTORY = 50;

    // Bind event handlers
    this.startPaint = this.startPaint.bind(this);
    this.paint = this.paint.bind(this);
    this.endPaint = this.endPaint.bind(this);
    this.handleCanvasClick = this.handleCanvasClick.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.handleKeyboard = this.handleKeyboard.bind(this);
    this.updateBrushCursor = this.updateBrushCursor.bind(this);
    this.hideBrushCursor = this.hideBrushCursor.bind(this);
  }

  saveToHistory() {
    // Remove any states after current step (when user drew something after undoing)
    this.historyStack = this.historyStack.slice(0, this.historyStep + 1);

    // Save current canvas state along with text and line data
    const canvasState = {
      imageData: this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height),
      textElements: JSON.parse(JSON.stringify(this.textElements)),
      lineSegments: JSON.parse(JSON.stringify(this.lineSegments)),
      todoItems: JSON.parse(JSON.stringify(this.todoItems)),
      scheduleData: this.scheduleData ? JSON.parse(JSON.stringify(this.scheduleData)) : null,
      scheduleCellFontSizes: this.scheduleCellFontSizes ? JSON.parse(JSON.stringify(this.scheduleCellFontSizes)) : null,
      scheduleDays: this.scheduleDays,
      scheduleClasses: this.scheduleClasses,
      scheduleFontFamily: this.scheduleFontFamily,
      scheduleFontSize: this.scheduleFontSize,
      scheduleColor: this.scheduleColor,
      scheduleStartX: this.scheduleStartX,
      scheduleStartY: this.scheduleStartY,
      scheduleCellWidth: this.scheduleCellWidth,
      scheduleCellHeight: this.scheduleCellHeight,
      scheduleBaseImageData: this.scheduleBaseImageData ? this.cloneImageData(this.scheduleBaseImageData) : null
    };

    this.historyStack.push(canvasState);
    this.historyStep++;

    // Limit history size
    if (this.historyStack.length > this.MAX_HISTORY) {
      this.historyStack.shift();
      this.historyStep--;
    }

    this.updateUndoRedoButtons();
  }

  clearHistory() {
    this.historyStack = [];
    this.historyStep = -1;
    this.updateUndoRedoButtons();
  }

  undo() {
    if (this.historyStep > 0) {
      this.historyStep--;
      this.restoreFromHistory();
    }
  }

  redo() {
    if (this.historyStep < this.historyStack.length - 1) {
      this.historyStep++;
      this.restoreFromHistory();
    }
  }

  restoreFromHistory() {
    if (this.historyStep >= 0 && this.historyStep < this.historyStack.length) {
      const state = this.historyStack[this.historyStep];

      // Restore canvas image
      this.ctx.putImageData(state.imageData, 0, 0);

      // Restore text and line data
      this.textElements = JSON.parse(JSON.stringify(state.textElements));
      this.lineSegments = JSON.parse(JSON.stringify(state.lineSegments));
      this.todoItems = JSON.parse(JSON.stringify(state.todoItems || []));
      this.scheduleData = state.scheduleData ? JSON.parse(JSON.stringify(state.scheduleData)) : null;
      this.scheduleCellFontSizes = state.scheduleCellFontSizes ? JSON.parse(JSON.stringify(state.scheduleCellFontSizes)) : null;
      this.scheduleDays = state.scheduleDays || this.scheduleDays;
      this.scheduleClasses = state.scheduleClasses || this.scheduleClasses;
      this.scheduleFontFamily = state.scheduleFontFamily || this.scheduleFontFamily;
      this.scheduleFontSize = state.scheduleFontSize || this.scheduleFontSize;
      this.scheduleColor = state.scheduleColor || this.scheduleColor;
      this.scheduleStartX = Number.isFinite(state.scheduleStartX) ? state.scheduleStartX : this.scheduleStartX;
      this.scheduleStartY = Number.isFinite(state.scheduleStartY) ? state.scheduleStartY : this.scheduleStartY;
      this.scheduleCellWidth = state.scheduleCellWidth || this.scheduleCellWidth;
      this.scheduleCellHeight = state.scheduleCellHeight || this.scheduleCellHeight;
      this.scheduleBaseImageData = state.scheduleBaseImageData ? this.cloneImageData(state.scheduleBaseImageData) : null;

      this.updateUndoRedoButtons();
      this.markCanvasChanged();
    }
  }

  updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (undoBtn) {
      undoBtn.disabled = this.historyStep <= 0;
    }

    if (redoBtn) {
      redoBtn.disabled = this.historyStep >= this.historyStack.length - 1;
    }
  }

  initPaintTools() {
    document.getElementById('brush-mode').addEventListener('click', () => {
      if (this.currentTool === 'brush') {
        this.setActiveTool(null, '');
      } else {
        this.setActiveTool('brush', '画笔模式');
        this.brushColor = document.getElementById('brush-color').value;
      }
    });

    document.getElementById('eraser-mode').addEventListener('click', () => {
      if (this.currentTool === 'eraser') {
        this.setActiveTool('brush', '画笔模式');
        this.brushColor = document.getElementById('brush-color').value;
      } else {
        this.setActiveTool('eraser', '橡皮擦');
        this.brushColor = "#FFFFFF";
      }
    });

    document.getElementById('text-mode').addEventListener('click', () => {
      if (this.currentTool === 'text') {
        this.setActiveTool(null, '');
      } else {
        this.setActiveTool('text', '插入文字');
        this.brushColor = document.getElementById('brush-color').value;
      }
    });

    document.getElementById('brush-color').addEventListener('change', (e) => {
      this.brushColor = e.target.value;
      if (this.selectedTextElement) {
        this.selectedTextElement.color = this.brushColor;
        this.redrawAll();
        this.saveToHistory();
        this.markCanvasChanged();
      }
    });

    document.getElementById('brush-size').addEventListener('input', (e) => {
      this.updateBrushSize(e.target.value);
    });
    document.getElementById('brush-size-range').addEventListener('input', (e) => {
      this.updateBrushSize(e.target.value);
    });

    document.getElementById('font-size').addEventListener('input', (e) => this.updateSelectedTextFontSize(e.target.value, false));
    document.getElementById('font-size').addEventListener('change', (e) => this.updateSelectedTextFontSize(e.target.value, true));
    document.getElementById('font-size-range').addEventListener('input', (e) => this.updateSelectedTextFontSize(e.target.value, false));
    document.getElementById('font-size-range').addEventListener('change', (e) => this.updateSelectedTextFontSize(e.target.value, true));

    document.getElementById('add-text-btn').addEventListener('click', () => this.startTextPlacement());

    document.getElementById('todo-mode').addEventListener('click', () => {
      if (this.currentTool === 'todo') {
        this.setActiveTool(null, '');
      } else {
        this.setActiveTool('todo', '添加待办项');
        this.todoColor = document.getElementById('todo-color').value;
      }
    });

    document.getElementById('add-todo-btn').addEventListener('click', () => this.startTodoPlacement());

    document.getElementById('schedule-mode').addEventListener('click', () => {
      if (this.currentTool === 'schedule') {
        this.setActiveTool(null, '');
      } else {
        this.loadScheduleFromLocalStorage();
        this.setActiveTool('schedule', '生成课表');
      }
    });

    document.getElementById('matter-mode').addEventListener('click', () => {
      if (this.currentTool === 'matter') {
        this.setActiveTool(null, '');
      } else {
        this.loadMatterData();
        this.renderMatterTables();
        this.setActiveTool('matter', '事项模板');
      }
    });

    document.getElementById('create-schedule-btn').addEventListener('click', () => this.createSchedule());
    document.getElementById('schedule-input-confirm-btn').addEventListener('click', () => this.confirmScheduleInput());
    document.getElementById('schedule-input-cancel-btn').addEventListener('click', () => this.cancelScheduleInput());
    document.getElementById('matter-render-btn').addEventListener('click', () => this.renderMatterTemplateToCanvas());
    document.getElementById('matter-add-limit-btn').addEventListener('click', () => this.addMatterTimeLimit());
    document.getElementById('matter-add-todo-btn').addEventListener('click', () => this.addMatterTodo());
    document.getElementById('matter-add-schedule-btn').addEventListener('click', () => this.addMatterSchedule());
    document.getElementById('matter-clear-btn').addEventListener('click', () => this.clearMatterData());

    document.getElementById('todo-bold').addEventListener('click', () => {
      this.todoBold = !this.todoBold;
      document.getElementById('todo-bold').classList.toggle('primary', this.todoBold);
      this.updateSelectedTodoStyle(true);
    });

    document.getElementById('todo-italic').addEventListener('click', () => {
      this.todoItalic = !this.todoItalic;
      document.getElementById('todo-italic').classList.toggle('primary', this.todoItalic);
      this.updateSelectedTodoStyle(true);
    });

    document.getElementById('todo-color').addEventListener('change', (e) => {
      this.todoColor = e.target.value;
      if (this.selectedTodoItem) {
        this.selectedTodoItem.color = this.todoColor;
        this.redrawAll();
        this.saveToHistory();
        this.markCanvasChanged();
      }
    });

    document.getElementById('todo-font-size').addEventListener('input', (e) => this.updateSelectedTodoFontSize(e.target.value, false));
    document.getElementById('todo-font-size').addEventListener('change', (e) => this.updateSelectedTodoFontSize(e.target.value, true));
    document.getElementById('todo-font-size-range').addEventListener('input', (e) => this.updateSelectedTodoFontSize(e.target.value, false));
    document.getElementById('todo-font-size-range').addEventListener('change', (e) => this.updateSelectedTodoFontSize(e.target.value, true));
    document.getElementById('font-family').addEventListener('change', () => this.updateSharedFontFamily(true));

    document.getElementById('toggle-todo-delete-btn').addEventListener('click', () => {
      this.showTodoDeleteButtons = !this.showTodoDeleteButtons;
      document.getElementById('toggle-todo-delete-btn').classList.toggle('primary', this.showTodoDeleteButtons);
      if (this.todoItems.length > 0) {
        this.ensureBaseImageData();
        this.redrawAll();
        this.markCanvasChanged();
      }
    });

    document.getElementById('toggle-schedule-cell-indicator-btn').addEventListener('click', () => {
      this.showScheduleCellIndicator = !this.showScheduleCellIndicator;
      document.getElementById('toggle-schedule-cell-indicator-btn').classList.toggle('primary', this.showScheduleCellIndicator);
      if (this.scheduleData) this.redrawAll();
      this.markCanvasChanged();
    });

    document.getElementById('schedule-font-increase-btn').addEventListener('click', () => this.adjustScheduleFontSize(1));
    document.getElementById('schedule-font-decrease-btn').addEventListener('click', () => this.adjustScheduleFontSize(-1));
    document.getElementById('schedule-font-size').addEventListener('change', (e) => this.setScheduleFontSize(parseInt(e.target.value, 10)));
    document.getElementById('schedule-color').addEventListener('change', (e) => {
      this.scheduleColor = e.target.value;
      if (this.scheduleData) this.redrawAll();
      this.markCanvasChanged();
    });
    document.getElementById('schedule-move-up-btn').addEventListener('click', () => this.moveSchedule(0, -10));
    document.getElementById('schedule-move-down-btn').addEventListener('click', () => this.moveSchedule(0, 10));
    document.getElementById('schedule-move-left-btn').addEventListener('click', () => this.moveSchedule(-10, 0));
    document.getElementById('schedule-move-right-btn').addEventListener('click', () => this.moveSchedule(10, 0));
    document.getElementById('schedule-zoom-in-btn').addEventListener('click', () => this.zoomSchedule(5));
    document.getElementById('schedule-zoom-out-btn').addEventListener('click', () => this.zoomSchedule(-5));

    // Add event listeners for bold and italic buttons
    document.getElementById('text-bold').addEventListener('click', () => {
      this.textBold = !this.textBold;
      document.getElementById('text-bold').classList.toggle('primary', this.textBold);
      this.updateSelectedTextStyle(true);
    });

    document.getElementById('text-italic').addEventListener('click', () => {
      this.textItalic = !this.textItalic;
      document.getElementById('text-italic').classList.toggle('primary', this.textItalic);
      this.updateSelectedTextStyle(true);
    });

    // Add undo/redo button listeners
    document.getElementById('undo-btn').addEventListener('click', () => this.undo());
    document.getElementById('redo-btn').addEventListener('click', () => this.redo());

    this.canvas.addEventListener('mousedown', this.startPaint);
    this.canvas.addEventListener('mousemove', this.paint);
    this.canvas.addEventListener('mouseup', this.endPaint);
    this.canvas.addEventListener('mouseleave', this.endPaint);
    this.canvas.addEventListener('click', this.handleCanvasClick);

    // Touch support
    this.canvas.addEventListener('touchstart', this.onTouchStart);
    this.canvas.addEventListener('touchmove', this.onTouchMove);
    this.canvas.addEventListener('touchend', this.onTouchEnd);

    // Keyboard shortcuts for undo/redo
    document.addEventListener('keydown', this.handleKeyboard);

    // Mouse move for brush cursor
    this.canvas.addEventListener('mouseenter', this.updateBrushCursor);
    this.canvas.addEventListener('mousemove', this.updateBrushCursor);

    // Create brush cursor element
    this.createBrushCursor();

    // Initialize history with blank canvas state
    this.saveToHistory();
  }

  handleKeyboard(e) {
    // Ctrl+Z or Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    }
    // Ctrl+Y or Ctrl+Shift+Z or Cmd+Shift+Z for redo
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      this.redo();
    }
  }

  setActiveTool(tool, title) {
    setCanvasTitle(title);
    this.currentTool = tool;

    this.canvas.parentNode.classList.toggle('brush-mode', this.currentTool === 'brush');
    this.canvas.parentNode.classList.toggle('eraser-mode', this.currentTool === 'eraser');
    this.canvas.parentNode.classList.toggle('text-mode', this.currentTool === 'text');
    this.canvas.parentNode.classList.toggle('todo-mode', this.currentTool === 'todo');
    this.canvas.parentNode.classList.toggle('schedule-mode', this.currentTool === 'schedule');
    this.canvas.parentNode.classList.toggle('matter-mode', this.currentTool === 'matter');

    document.getElementById('brush-mode').classList.toggle('active', this.currentTool === 'brush' || this.currentTool === 'eraser');
    document.getElementById('eraser-mode').classList.toggle('active', this.currentTool === 'eraser');
    document.getElementById('text-mode').classList.toggle('active', this.currentTool === 'text');
    document.getElementById('todo-mode').classList.toggle('active', this.currentTool === 'todo');
    document.getElementById('schedule-mode').classList.toggle('active', this.currentTool === 'schedule');
    document.getElementById('matter-mode').classList.toggle('active', this.currentTool === 'matter');

    document.getElementById('brush-color').disabled = this.currentTool === 'eraser' || this.currentTool === 'todo' || this.currentTool === 'schedule' || this.currentTool === 'matter';
    document.getElementById('brush-size').disabled = this.currentTool === 'text' || this.currentTool === 'todo' || this.currentTool === 'schedule' || this.currentTool === 'matter';

    document.getElementById('undo-btn').classList.toggle('hide', this.currentTool === null);
    document.getElementById('redo-btn').classList.toggle('hide', this.currentTool === null);

    // Cancel any pending text placement
    this.cancelTextPlacement();
    this.cancelTodoPlacement();
    this.cancelScheduleInput(false);

    if (this.hasOverlayElements()) {
      this.redrawAll();
    }
    if (typeof cropManager !== 'undefined' && cropManager && cropManager.refreshInteractionState) {
      cropManager.refreshInteractionState();
    }
  }

  createBrushCursor() {
    // Create a div element to show as brush cursor
    this.brushCursor = document.createElement('div');
    this.brushCursor.id = 'brush-cursor';
    this.brushCursor.style.position = 'fixed';
    this.brushCursor.style.border = '2px solid rgba(0, 0, 0, 0.5)';
    this.brushCursor.style.borderRadius = '50%';
    this.brushCursor.style.pointerEvents = 'none';
    this.brushCursor.style.display = 'none';
    this.brushCursor.style.zIndex = '10000';
    this.brushCursor.style.transform = 'translate(-50%, -50%)';
    this.brushCursor.style.willChange = 'transform';
    this.brushCursor.style.left = '0';
    this.brushCursor.style.top = '0';
    document.body.appendChild(this.brushCursor);
    this.updateBrushCursorSize();

    // For requestAnimationFrame throttling
    this.cursorUpdateScheduled = false;
    this.pendingCursorX = 0;
    this.pendingCursorY = 0;
  }

  updateBrushCursorSize() {
    if (!this.brushCursor) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.canvas.width;
    const scaleY = rect.height / this.canvas.height;
    const scale = Math.min(scaleX, scaleY);

    const size = this.brushSize * scale;
    this.brushCursor.style.width = size + 'px';
    this.brushCursor.style.height = size + 'px';
  }

  updateBrushCursor(e) {
    if (!this.brushCursor) return;

    if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
      // Check if mouse is within canvas bounds
      const rect = this.canvas.getBoundingClientRect();
      const isInCanvas = e.clientX >= rect.left && 
                         e.clientX <= rect.right && 
                         e.clientY >= rect.top && 
                         e.clientY <= rect.bottom;

      if (isInCanvas) {
        this.brushCursor.style.display = 'block';
        this.canvas.style.cursor = 'none';

        // Store the pending position
        this.pendingCursorX = e.clientX;
        this.pendingCursorY = e.clientY;

        // Schedule update using requestAnimationFrame for smooth movement
        if (!this.cursorUpdateScheduled) {
          this.cursorUpdateScheduled = true;
          requestAnimationFrame(() => {
            this.brushCursor.style.transform = `translate(${this.pendingCursorX}px, ${this.pendingCursorY}px) translate(-50%, -50%)`;
            this.cursorUpdateScheduled = false;
          });
        }

        // Update color to match brush or show white for eraser (only needs to happen once or when tool changes)
        if (this.currentTool === 'eraser') {
          if (this.brushCursor.getAttribute('data-tool') !== 'eraser') {
            this.brushCursor.style.border = '2px solid rgba(255, 0, 0, 0.7)';
            this.brushCursor.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
            this.brushCursor.style.boxShadow = 'none';
            this.brushCursor.setAttribute('data-tool', 'eraser');
          }
        } else {
          if (this.brushCursor.getAttribute('data-tool') !== 'brush') {
            // Use a contrasting border - white with black outline for visibility
            this.brushCursor.style.border = '1px solid white';
            this.brushCursor.style.boxShadow = '0 0 0 1px black, inset 0 0 0 1px black';
            this.brushCursor.style.backgroundColor = 'transparent';
            this.brushCursor.setAttribute('data-tool', 'brush');
          }
        }
      } else {
        // Hide cursor when outside canvas
        this.brushCursor.style.display = 'none';
      }
    }
  }

  hideBrushCursor() {
    if (this.brushCursor) {
      this.brushCursor.style.display = 'none';
    }
    this.canvas.style.cursor = 'default';
  }

  startPaint(e) {
    if (!this.currentTool) return;

    if (this.currentTool === 'text') {
      const textElement = this.findTextElementAt(e);
      if (textElement) {
        this.selectTextElement(textElement);
        this.isDraggingText = true;

        const point = this.getCanvasPoint(e);

        // Calculate offset for smooth dragging
        this.dragOffsetX = textElement.x - point.x;
        this.dragOffsetY = textElement.y - point.y;
        this.draggingCanvasContext = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

        return; // Don't start drawing
      }
    } else if (this.currentTool === 'todo') {
      const deleteButtonTodo = this.findTodoDeleteButtonAt(e);
      if (deleteButtonTodo) {
        this.deleteTodoItem(deleteButtonTodo);
        return;
      }

      const todoItem = this.findTodoItemAt(e);
      if (todoItem) {
        this.selectTodoItem(todoItem);
        this.isDraggingText = true;

        const point = this.getCanvasPoint(e);
        this.dragOffsetX = todoItem.x - point.x;
        this.dragOffsetY = todoItem.y - point.y;
        this.draggingCanvasContext = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        return;
      }
    } else if (this.currentTool === 'schedule') {
      return;
    } else {
      this.painting = true;
      this.draw(e);
    }
  }

  endPaint() {
    if (this.isDraggingText) {
      if (this.selectedTodoItem) this.redrawAll();
      this.saveToHistory();
      this.markCanvasChanged();
    } else if (this.painting) {
      this.saveToHistory(); // Save state after drawing or dragging text
      this.markCanvasChanged();
    }
    this.painting = false;
    this.isDraggingText = false;
    this.lastX = 0;
    this.lastY = 0;

    this.hideBrushCursor();
  }

  paint(e) {
    if (!this.currentTool) return;

    if (this.currentTool === 'text') {
      if (this.isDraggingText && this.selectedTextElement) {
        this.dragText(e);
      }
    } else if (this.currentTool === 'todo') {
      if (this.isDraggingText && this.selectedTodoItem) {
        this.dragTodo(e);
      }
    } else {
      if (this.painting) {
        this.draw(e);
      }
    }
  }

  draw(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';
    this.ctx.strokeStyle = this.brushColor;
    this.ctx.lineWidth = this.brushSize;

    this.ctx.beginPath();

    if (this.lastX === 0 && this.lastY === 0) {
      // For the first point, just do a dot
      this.ctx.moveTo(x, y);
      this.ctx.lineTo(x + 0.1, y + 0.1);

      // Store the dot for redrawing
      this.lineSegments.push({
        type: 'dot',
        x: x,
        y: y,
        color: this.brushColor,
        size: this.brushSize
      });
    } else {
      // Connect to the previous point
      this.ctx.moveTo(this.lastX, this.lastY);
      this.ctx.lineTo(x, y);

      // Store the line segment for redrawing
      this.lineSegments.push({
        type: 'line',
        x1: this.lastX,
        y1: this.lastY,
        x2: x,
        y2: y,
        color: this.brushColor,
        size: this.brushSize
      });
    }

    this.ctx.stroke();

    this.lastX = x;
    this.lastY = y;
  }

  handleCanvasClick(e) {
    if (this.currentTool === 'text' && this.isTextPlacementMode) {
      this.placeText(e);
    } else if (this.currentTool === 'todo' && this.isTodoPlacementMode) {
      this.placeTodo(e);
    } else if (this.currentTool === 'schedule') {
      const cell = this.getScheduleCellAt(e);
      if (cell) {
        this.selectedScheduleCell = cell;
        document.getElementById('schedule-input').value = this.scheduleData[cell.row][cell.col];
        if (this.scheduleCellFontSizes) {
          document.getElementById('schedule-font-size').value = this.scheduleCellFontSizes[cell.row][cell.col];
        }
        document.querySelector('.schedule-input-tools').style.display = 'flex';
        document.getElementById('schedule-input').focus();
        this.redrawAll();
      }
    }
  }

  onTouchStart(e) {
    if (!this.currentTool) return;
    e.preventDefault();
    const touch = e.touches[0];

    // If in text placement mode, handle as a click
    if ((this.currentTool === 'text' && this.isTextPlacementMode) ||
        (this.currentTool === 'todo' && this.isTodoPlacementMode) ||
        this.currentTool === 'schedule') {
      const mouseEvent = new MouseEvent('click', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
      return;
    }

    // Otherwise handle as normal drawing
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this.canvas.dispatchEvent(mouseEvent);
  }

  onTouchMove(e) {
    if (!this.currentTool) return;
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this.canvas.dispatchEvent(mouseEvent);
  }

  onTouchEnd(e) {
    if (!this.currentTool) return;
    e.preventDefault();
    this.endPaint();
  }

  dragText(e) {
    const point = this.getCanvasPoint(e);

    // Update text position with offset
    this.selectedTextElement.x = point.x + this.dragOffsetX;
    this.selectedTextElement.y = point.y + this.dragOffsetY;

    this.redrawAll();
  }

  findTextElementAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Search through text elements in reverse order (top-most first)
    for (let i = this.textElements.length - 1; i >= 0; i--) {
      const text = this.textElements[i];

      // Calculate text dimensions
      this.ctx.font = text.font;
      const textWidth = this.ctx.measureText(text.text).width;

      // Extract font size correctly from the font string
      const fontSizeMatch = text.font.match(/(\d+)px/);
      const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 14;
      const textHeight = fontSize * 1.2; // Approximate height

      // Check if click is within text bounds (allowing for some margin)
      const margin = 5;
      if (x >= text.x - margin &&
        x <= text.x + textWidth + margin &&
        y >= text.y - textHeight + margin &&
        y <= text.y + margin) {
        return text;
      }
    }

    return null;
  }

  markCanvasChanged() {
    if (typeof resetDitherPreviewSource === 'function') {
      resetDitherPreviewSource();
    }
    if (typeof cropManager !== 'undefined' && cropManager && cropManager.refreshInteractionState) {
      cropManager.refreshInteractionState();
    }
  }

  getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  getTextMetrics(text, font) {
    this.ctx.font = font;
    const width = this.ctx.measureText(text).width;
    const fontSizeMatch = font.match(/(\d+)px/);
    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1], 10) : 14;
    return { width, height: fontSize * 1.2, fontSize };
  }

  drawCanvasText(text, x, y, font, color) {
    this.ctx.font = font;
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, x, y);
    return this.getTextMetrics(text, font);
  }

  drawSolidLine(x, y, width, height, color = '#000000') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  measureTextWidth(text, font) {
    this.ctx.font = font;
    return this.ctx.measureText(text).width;
  }

  wrapTextForWidth(text, font, maxWidth) {
    const sourceLines = String(text || '').split('\n');
    const lines = [];

    sourceLines.forEach(sourceLine => {
      if (sourceLine === '') {
        lines.push('');
        return;
      }

      let current = '';
      for (const char of sourceLine) {
        const next = current + char;
        if (current && this.measureTextWidth(next, font) > maxWidth) {
          lines.push(current);
          current = char;
        } else {
          current = next;
        }
      }
      if (current) lines.push(current);
    });

    return lines.length > 0 ? lines : [''];
  }

  fitScheduleText(text, baseFontSize, family, maxWidth, maxHeight) {
    let fontSize = Math.max(6, baseFontSize);
    let lines = [];
    let lineHeight = fontSize * 1.18;

    while (fontSize >= 6) {
      const font = `${fontSize}px ${family}`;
      lines = this.wrapTextForWidth(text, font, maxWidth);
      lineHeight = Math.max(7, fontSize * 1.18);
      if (lines.length * lineHeight <= maxHeight) break;
      fontSize--;
    }

    return { fontSize, lines, lineHeight };
  }

  isMostlyTextTemplateCanvas() {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    const step = Math.max(4, Math.floor(Math.sqrt(this.canvas.width * this.canvas.height) / 32));
    let sampled = 0;
    let nonWhite = 0;

    for (let y = 0; y < this.canvas.height; y += step) {
      for (let x = 0; x < this.canvas.width; x += step) {
        const index = (y * this.canvas.width + x) * 4;
        sampled++;
        if (imageData[index] < 245 || imageData[index + 1] < 245 || imageData[index + 2] < 245) {
          nonWhite++;
        }
      }
    }

    return sampled === 0 || nonWhite / sampled < 0.18;
  }

  preferNoDitherForTextTemplate() {
    const ditherAlg = document.getElementById('ditherAlg');
    if (ditherAlg && ditherAlg.value !== 'none' && this.isMostlyTextTemplateCanvas()) {
      ditherAlg.value = 'none';
    }
  }

  cloneImageData(imageData) {
    return new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
  }

  ensureBaseImageData() {
    if (!this.scheduleBaseImageData) {
      this.scheduleBaseImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  setBaseImageData() {
    this.scheduleBaseImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  hasOverlayElements() {
    return this.lineSegments.length > 0 ||
      this.textElements.length > 0 ||
      this.todoItems.length > 0 ||
      !!this.scheduleData;
  }

  getFontParts(font) {
    const match = font.match(/^(.*?)(\d+)px\s+(.+)$/);
    if (!match) return { prefix: '', size: 16, family: 'Arial' };
    return {
      prefix: match[1],
      size: parseInt(match[2], 10),
      family: match[3]
    };
  }

  withFontSize(font, size) {
    const parts = this.getFontParts(font);
    return `${parts.prefix}${size}px ${parts.family}`;
  }

  buildFont(size, family, bold, italic) {
    let fontStyle = '';
    if (italic) fontStyle += 'italic ';
    if (bold) fontStyle += 'bold ';
    return `${fontStyle}${size}px ${family}`;
  }

  getSharedFontFamily() {
    const fontFamily = document.getElementById('font-family');
    return fontFamily ? fontFamily.value : 'Arial';
  }

  setSharedFontFamily(family) {
    const fontFamily = document.getElementById('font-family');
    if (!fontFamily) return;
    const exists = [...fontFamily.options].some(option => option.value === family);
    if (exists) fontFamily.value = family;
  }

  syncRangeAndNumber(numberId, rangeId, value) {
    const numberInput = document.getElementById(numberId);
    const rangeInput = document.getElementById(rangeId);
    if (numberInput) numberInput.value = value;
    if (rangeInput) rangeInput.value = value;
  }

  updateBrushSize(value) {
    const size = Math.max(1, Math.min(100, parseInt(value, 10) || 1));
    this.brushSize = size;
    this.syncRangeAndNumber('brush-size', 'brush-size-range', size);
    this.updateBrushCursorSize();
  }

  selectTextElement(textElement) {
    this.selectedTextElement = textElement;
    this.selectedTodoItem = null;
    const parts = this.getFontParts(textElement.font);
    document.getElementById('text-input').value = textElement.text;
    document.getElementById('font-family').value = parts.family;
    this.syncRangeAndNumber('font-size', 'font-size-range', parts.size);
    this.textBold = /\bbold\b/.test(textElement.font);
    this.textItalic = /\bitalic\b/.test(textElement.font);
    document.getElementById('text-bold').classList.toggle('primary', this.textBold);
    document.getElementById('text-italic').classList.toggle('primary', this.textItalic);
    this.brushColor = textElement.color;
    const brushColor = document.getElementById('brush-color');
    if ([...brushColor.options].some(option => option.value === textElement.color)) {
      brushColor.value = textElement.color;
    }
    setCanvasTitle('已选中文字，可拖动滑条调整大小');
  }

  selectTodoItem(todoItem) {
    this.selectedTodoItem = todoItem;
    this.selectedTextElement = null;
    const parts = this.getFontParts(todoItem.font);
    document.getElementById('todo-input').value = todoItem.text;
    this.setSharedFontFamily(parts.family);
    this.syncRangeAndNumber('todo-font-size', 'todo-font-size-range', parts.size);
    this.todoBold = /\bbold\b/.test(todoItem.font);
    this.todoItalic = /\bitalic\b/.test(todoItem.font);
    document.getElementById('todo-bold').classList.toggle('primary', this.todoBold);
    document.getElementById('todo-italic').classList.toggle('primary', this.todoItalic);
    this.todoColor = todoItem.color;
    document.getElementById('todo-color').value = todoItem.color;
    setCanvasTitle('已选中待办，可拖动滑条调整大小');
  }

  updateSelectedTextFontSize(value, commitHistory) {
    const size = Math.max(1, Math.min(100, parseInt(value, 10) || 16));
    this.syncRangeAndNumber('font-size', 'font-size-range', size);
    if (!this.selectedTextElement) return;
    this.selectedTextElement.font = this.buildFont(size, document.getElementById('font-family').value, this.textBold, this.textItalic);
    this.redrawAll();
    this.markCanvasChanged();
    if (commitHistory) this.saveToHistory();
  }

  updateSelectedTodoFontSize(value, commitHistory) {
    const size = Math.max(8, Math.min(100, parseInt(value, 10) || 16));
    this.syncRangeAndNumber('todo-font-size', 'todo-font-size-range', size);
    if (!this.selectedTodoItem) return;
    this.selectedTodoItem.font = this.buildFont(size, this.getSharedFontFamily(), this.todoBold, this.todoItalic);
    this.redrawAll();
    this.markCanvasChanged();
    if (commitHistory) this.saveToHistory();
  }

  updateSelectedTextStyle(commitHistory) {
    if (!this.selectedTextElement) return;
    const size = parseInt(document.getElementById('font-size').value, 10) || this.getFontParts(this.selectedTextElement.font).size;
    this.selectedTextElement.font = this.buildFont(size, document.getElementById('font-family').value, this.textBold, this.textItalic);
    this.redrawAll();
    this.markCanvasChanged();
    if (commitHistory) this.saveToHistory();
  }

  updateSelectedTodoStyle(commitHistory) {
    if (!this.selectedTodoItem) return;
    const size = parseInt(document.getElementById('todo-font-size').value, 10) || this.getFontParts(this.selectedTodoItem.font).size;
    this.selectedTodoItem.font = this.buildFont(size, this.getSharedFontFamily(), this.todoBold, this.todoItalic);
    this.redrawAll();
    this.markCanvasChanged();
    if (commitHistory) this.saveToHistory();
  }

  updateSharedFontFamily(commitHistory) {
    let changed = false;

    if (this.selectedTextElement) {
      this.updateSelectedTextStyle(false);
      changed = true;
    }

    if (this.selectedTodoItem) {
      this.updateSelectedTodoStyle(false);
      changed = true;
    }

    if (this.currentTool === 'schedule' || this.scheduleData) {
      this.scheduleFontFamily = this.getSharedFontFamily();
      if (this.scheduleData) {
        this.redrawAll();
        changed = true;
      }
    }

    if (changed) {
      this.markCanvasChanged();
      if (commitHistory) this.saveToHistory();
    }
  }

  cancelTodoPlacement() {
    this.isTodoPlacementMode = false;
    if (this.canvas) this.canvas.classList.remove('text-placement-mode');
  }

  startTodoPlacement() {
    const todo = document.getElementById('todo-input').value.trim();
    if (!todo) {
      alert('请输入待办项内容');
      return;
    }

    this.isTodoPlacementMode = true;
    setCanvasTitle('点击画布放置待办项');
    this.canvas.classList.add('text-placement-mode');
  }

  placeTodo(e) {
    const point = this.getCanvasPoint(e);
    const todo = document.getElementById('todo-input').value;
    const fontSize = document.getElementById('todo-font-size').value;
    const fontFamily = this.getSharedFontFamily();

    this.ensureBaseImageData();
    this.preferNoDitherForTextTemplate();

    let fontStyle = '';
    if (this.todoItalic) fontStyle += 'italic ';
    if (this.todoBold) fontStyle += 'bold ';

    const newTodo = {
      text: todo,
      x: point.x,
      y: point.y,
      font: `${fontStyle}${fontSize}px ${fontFamily}`,
      color: this.todoColor,
      completed: false
    };

    this.todoItems.push(newTodo);
    this.selectedTodoItem = newTodo;
    this.selectTodoItem(newTodo);
    this.redrawAll();
    this.saveToHistory();
    this.markCanvasChanged();

    document.getElementById('todo-input').value = '';
    this.cancelTodoPlacement();
    setCanvasTitle('拖动待办项可调整位置，点击文字可切换完成状态');
  }

  drawTodoItem(todoItem) {
    const metrics = this.drawCanvasText(todoItem.text, todoItem.x, todoItem.y, todoItem.font, todoItem.color);
    if (todoItem.completed) {
      this.drawSolidLine(
        todoItem.x,
        todoItem.y - metrics.fontSize * 0.42,
        metrics.width,
        Math.max(1, Math.ceil(metrics.fontSize / 12)),
        todoItem.color
      );
    }

    if (this.showTodoDeleteButtons) {
      todoItem.deleteButtonCenterX = todoItem.x + metrics.width + 12;
      todoItem.deleteButtonCenterY = todoItem.y - metrics.fontSize * 0.45;
      todoItem.deleteButtonHitRadius = 10;
      this.drawCanvasText('x', todoItem.deleteButtonCenterX - 4, todoItem.deleteButtonCenterY + 5, 'bold 14px Arial', '#FF0000');
    } else {
      todoItem.deleteButtonCenterX = null;
      todoItem.deleteButtonCenterY = null;
      todoItem.deleteButtonHitRadius = null;
    }
  }

  redrawTodoItems() {
    this.todoItems.forEach(item => this.drawTodoItem(item));
  }

  findTodoItemAt(e) {
    const point = this.getCanvasPoint(e);
    for (let i = this.todoItems.length - 1; i >= 0; i--) {
      const todo = this.todoItems[i];
      const metrics = this.getTextMetrics(todo.text, todo.font);
      const margin = 6;
      if (point.x >= todo.x - margin &&
        point.x <= todo.x + metrics.width + margin &&
        point.y >= todo.y - metrics.height + margin &&
        point.y <= todo.y + margin) {
        return todo;
      }
    }
    return null;
  }

  findTodoDeleteButtonAt(e) {
    if (!this.showTodoDeleteButtons) return null;
    const point = this.getCanvasPoint(e);
    for (let i = this.todoItems.length - 1; i >= 0; i--) {
      const todo = this.todoItems[i];
      if (!todo.deleteButtonHitRadius) continue;
      const dx = point.x - todo.deleteButtonCenterX;
      const dy = point.y - todo.deleteButtonCenterY;
      if (Math.sqrt(dx * dx + dy * dy) <= todo.deleteButtonHitRadius) {
        return todo;
      }
    }
    return null;
  }

  deleteTodoItem(todoItem) {
    const index = this.todoItems.indexOf(todoItem);
    if (index < 0) return;
    this.todoItems.splice(index, 1);
    this.redrawAll();
    this.saveToHistory();
    this.markCanvasChanged();
  }

  dragTodo(e) {
    const point = this.getCanvasPoint(e);
    this.selectedTodoItem.x = point.x + this.dragOffsetX;
    this.selectedTodoItem.y = point.y + this.dragOffsetY;

    this.redrawAll();
  }

  redrawAll() {
    if (this.scheduleBaseImageData) {
      this.ctx.putImageData(this.scheduleBaseImageData, 0, 0);
    } else {
      this.ctx.fillStyle = 'white';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.redrawLineSegments();
    this.redrawTextElements();
    this.redrawTodoItems();
    this.drawSchedule();
  }

  createSchedule() {
    this.scheduleDays = parseInt(document.getElementById('schedule-days').value, 10);
    this.scheduleClasses = parseInt(document.getElementById('schedule-classes').value, 10);
    this.scheduleFontFamily = this.getSharedFontFamily();
    this.scheduleFontSize = parseInt(document.getElementById('schedule-font-size').value, 10);
    this.scheduleColor = document.getElementById('schedule-color').value;
    this.ensureBaseImageData();
    this.preferNoDitherForTextTemplate();
    this.calculateScheduleDimensions();

    this.scheduleData = [];
    this.scheduleCellFontSizes = [];
    for (let row = 0; row <= this.scheduleClasses; row++) {
      this.scheduleData[row] = [];
      this.scheduleCellFontSizes[row] = [];
      for (let col = 0; col <= this.scheduleDays; col++) {
        this.scheduleCellFontSizes[row][col] = this.scheduleFontSize;
        if (row === 0 && col === 0) this.scheduleData[row][col] = '';
        else if (row === 0) this.scheduleData[row][col] = this.weekDays[col - 1];
        else if (col === 0) this.scheduleData[row][col] = `第${row}节`;
        else this.scheduleData[row][col] = '';
      }
    }

    this.redrawAll();
    this.saveScheduleToLocalStorage();
    this.saveToHistory();
    this.markCanvasChanged();
  }

  calculateScheduleDimensions() {
    const padding = Math.max(8, Math.floor(Math.min(this.canvas.width, this.canvas.height) * 0.04));
    const availableWidth = this.canvas.width - padding * 2;
    const availableHeight = this.canvas.height - padding * 2;
    this.scheduleCellWidth = Math.max(30, Math.floor(availableWidth / (this.scheduleDays + 1)));
    this.scheduleCellHeight = Math.max(20, Math.floor(availableHeight / (this.scheduleClasses + 1)));
    this.scheduleStartX = padding;
    this.scheduleStartY = padding;
  }

  drawSchedule() {
    if (!this.scheduleData) return;

    const cellWidth = this.scheduleCellWidth;
    const cellHeight = this.scheduleCellHeight;
    const rows = this.scheduleData.length;
    const cols = this.scheduleData[0] ? this.scheduleData[0].length : 0;
    const tableWidth = cols * cellWidth;
    const tableHeight = rows * cellHeight;

    for (let row = 0; row <= rows; row++) {
      this.drawSolidLine(this.scheduleStartX, this.scheduleStartY + row * cellHeight, tableWidth + 1, 1);
    }

    for (let col = 0; col <= cols; col++) {
      this.drawSolidLine(this.scheduleStartX + col * cellWidth, this.scheduleStartY, 1, tableHeight + 1);
    }

    for (let row = 0; row < this.scheduleData.length; row++) {
      for (let col = 0; col < this.scheduleData[row].length; col++) {
        const x = this.scheduleStartX + col * cellWidth;
        const y = this.scheduleStartY + row * cellHeight;

        const text = this.scheduleData[row][col];
        if (!text) continue;

        const baseFontSize = this.scheduleCellFontSizes && this.scheduleCellFontSizes[row]
          ? this.scheduleCellFontSizes[row][col]
          : this.scheduleFontSize;

        const horizontalPadding = Math.max(3, Math.floor(cellWidth * 0.08));
        const verticalPadding = Math.max(2, Math.floor(cellHeight * 0.08));
        const fitted = this.fitScheduleText(
          text,
          baseFontSize,
          this.scheduleFontFamily,
          cellWidth - horizontalPadding * 2,
          cellHeight - verticalPadding * 2
        );
        const font = `${fitted.fontSize}px ${this.scheduleFontFamily}`;
        const textStartY = y + (cellHeight - fitted.lines.length * fitted.lineHeight) / 2 + fitted.fontSize * 0.86;
        fitted.lines.forEach((line, lineIndex) => {
          const textWidth = this.measureTextWidth(line, font);
          const textX = x + (cellWidth - textWidth) / 2;
          this.drawCanvasText(line, textX, textStartY + lineIndex * fitted.lineHeight, font, this.scheduleColor);
        });
      }
    }

    if (this.showScheduleCellIndicator && this.selectedScheduleCell) {
      const x = this.scheduleStartX + this.selectedScheduleCell.col * cellWidth;
      const y = this.scheduleStartY + this.selectedScheduleCell.row * cellHeight;
      this.drawSolidLine(x + cellWidth - 9, y + 4, 5, 5);
    }
  }

  getScheduleCellAt(e) {
    if (!this.scheduleData) return null;
    const point = this.getCanvasPoint(e);
    const col = Math.floor((point.x - this.scheduleStartX) / this.scheduleCellWidth);
    const row = Math.floor((point.y - this.scheduleStartY) / this.scheduleCellHeight);
    if (row >= 0 && col >= 0 && row <= this.scheduleClasses && col <= this.scheduleDays) {
      return { row, col };
    }
    return null;
  }

  confirmScheduleInput() {
    if (!this.selectedScheduleCell) return;
    const { row, col } = this.selectedScheduleCell;
    this.scheduleData[row][col] = document.getElementById('schedule-input').value;
    this.cancelScheduleInput(false);
    this.redrawAll();
    this.saveScheduleToLocalStorage();
    this.saveToHistory();
    this.markCanvasChanged();
  }

  cancelScheduleInput(redraw = true) {
    const inputTools = document.querySelector('.schedule-input-tools');
    if (inputTools) inputTools.style.display = 'none';
    const scheduleInput = document.getElementById('schedule-input');
    if (scheduleInput) scheduleInput.value = '';
    this.selectedScheduleCell = null;
    if (redraw && this.scheduleData) this.redrawAll();
  }

  adjustScheduleFontSize(delta) {
    const nextValue = parseInt(document.getElementById('schedule-font-size').value, 10) + delta;
    this.setScheduleFontSize(nextValue);
  }

  setScheduleFontSize(value) {
    const fontSize = Math.max(6, Math.min(32, Number.isFinite(value) ? value : this.scheduleFontSize));
    document.getElementById('schedule-font-size').value = fontSize;

    if (this.selectedScheduleCell && this.scheduleCellFontSizes) {
      const { row, col } = this.selectedScheduleCell;
      this.scheduleCellFontSizes[row][col] = fontSize;
    } else {
      this.scheduleFontSize = fontSize;
    }

    if (this.scheduleData) {
      this.redrawAll();
      this.saveScheduleToLocalStorage();
      this.markCanvasChanged();
    }
  }

  moveSchedule(dx, dy) {
    if (!this.scheduleData) return;
    const tableWidth = (this.scheduleDays + 1) * this.scheduleCellWidth;
    const tableHeight = (this.scheduleClasses + 1) * this.scheduleCellHeight;
    this.scheduleStartX = Math.max(0, Math.min(this.canvas.width - tableWidth, this.scheduleStartX + dx));
    this.scheduleStartY = Math.max(0, Math.min(this.canvas.height - tableHeight, this.scheduleStartY + dy));
    this.redrawAll();
    this.saveScheduleToLocalStorage();
    this.markCanvasChanged();
  }

  zoomSchedule(delta) {
    if (!this.scheduleData) return;
    this.scheduleCellWidth = Math.max(24, Math.min(220, this.scheduleCellWidth + delta));
    this.scheduleCellHeight = Math.max(18, Math.min(120, this.scheduleCellHeight + delta));
    this.moveSchedule(0, 0);
  }

  saveScheduleToLocalStorage() {
    try {
      localStorage.setItem('scheduleCache', JSON.stringify({
        scheduleData: this.scheduleData,
        scheduleDays: this.scheduleDays,
        scheduleClasses: this.scheduleClasses,
        scheduleFontFamily: this.scheduleFontFamily,
        scheduleFontSize: this.scheduleFontSize,
        scheduleColor: this.scheduleColor,
        scheduleStartX: this.scheduleStartX,
        scheduleStartY: this.scheduleStartY,
        scheduleCellWidth: this.scheduleCellWidth,
        scheduleCellHeight: this.scheduleCellHeight,
        scheduleCellFontSizes: this.scheduleCellFontSizes
      }));
    } catch (e) {
      console.error('Failed to save schedule cache:', e);
    }
  }

  loadScheduleFromLocalStorage() {
    try {
      const savedData = localStorage.getItem('scheduleCache');
      if (!savedData) return false;
      const scheduleCache = JSON.parse(savedData);
      this.scheduleData = scheduleCache.scheduleData;
      this.scheduleDays = scheduleCache.scheduleDays || this.scheduleDays;
      this.scheduleClasses = scheduleCache.scheduleClasses || this.scheduleClasses;
      this.scheduleFontFamily = scheduleCache.scheduleFontFamily || this.scheduleFontFamily;
      this.setSharedFontFamily(this.scheduleFontFamily);
      this.scheduleFontSize = scheduleCache.scheduleFontSize || this.scheduleFontSize;
      this.scheduleColor = scheduleCache.scheduleColor || this.scheduleColor;
      this.scheduleStartX = scheduleCache.scheduleStartX || this.scheduleStartX;
      this.scheduleStartY = scheduleCache.scheduleStartY || this.scheduleStartY;
      this.scheduleCellWidth = scheduleCache.scheduleCellWidth || this.scheduleCellWidth;
      this.scheduleCellHeight = scheduleCache.scheduleCellHeight || this.scheduleCellHeight;
      this.scheduleCellFontSizes = scheduleCache.scheduleCellFontSizes || null;
      if (this.scheduleData) this.redrawAll();
      return !!this.scheduleData;
    } catch (e) {
      console.error('Failed to load schedule cache:', e);
      return false;
    }
  }

  clearScheduleCache() {
    try {
      localStorage.removeItem('scheduleCache');
    } catch (e) {
      console.error('Failed to clear schedule cache:', e);
    }
  }

  startTextPlacement() {
    const text = document.getElementById('text-input').value.trim();
    if (!text) {
      alert('请输入文字内容');
      return;
    }

    this.isTextPlacementMode = true;

    // Add visual feedback
    setCanvasTitle('点击画布放置文字');
    this.canvas.classList.add('text-placement-mode');
  }

  cancelTextPlacement() {
    this.isTextPlacementMode = false;
    this.canvas.classList.remove('text-placement-mode');

    // reset dragging state
    this.isDraggingText = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.selectedTextElement = null;
    this.draggingCanvasContext = null;
  }

  placeText(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const text = document.getElementById('text-input').value;
    const fontFamily = document.getElementById('font-family').value;
    const fontSize = document.getElementById('font-size').value;

    // Build font style string
    let fontStyle = '';
    if (this.textItalic) fontStyle += 'italic ';
    if (this.textBold) fontStyle += 'bold ';

    // Create a new text element
    const newText = {
      text: text,
      x: x,
      y: y,
      font: `${fontStyle}${fontSize}px ${fontFamily}`,
      color: this.brushColor
    };

    // Add to our list of text elements
    this.textElements.push(newText);

    // Select this text element for immediate dragging
    this.selectedTextElement = newText;
    this.selectTextElement(newText);
    this.ensureBaseImageData();
    this.draggingCanvasContext = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    this.redrawAll();

    // Save to history after placing text
    this.saveToHistory();
    this.markCanvasChanged();

    // Reset
    document.getElementById('text-input').value = '';
    this.isTextPlacementMode = false;
    this.canvas.classList.remove('text-placement-mode');
    setCanvasTitle('拖动新添加文字可调整位置');
  }

  redrawTextElements() {
    // Redraw all text elements after dithering
    this.textElements.forEach(item => {
      this.drawCanvasText(item.text, item.x, item.y, item.font, item.color);
    });
  }

  redrawLineSegments() {
    // Redraw all line segments after dithering
    this.lineSegments.forEach(segment => {
      this.ctx.lineJoin = 'round';
      this.ctx.lineCap = 'round';
      this.ctx.strokeStyle = segment.color;
      this.ctx.lineWidth = segment.size;
      this.ctx.beginPath();

      if (segment.type === 'dot') {
        this.ctx.moveTo(segment.x, segment.y);
        this.ctx.lineTo(segment.x + 0.1, segment.y + 0.1);
      } else {
        this.ctx.moveTo(segment.x1, segment.y1);
        this.ctx.lineTo(segment.x2, segment.y2);
      }

      this.ctx.stroke();
    });
  }

  getMatterStorageKey() {
    return 'matterTemplateCache';
  }

  getTodayIsoDate() {
    return new Date().toISOString().split('T')[0];
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  loadMatterData() {
    try {
      const cache = localStorage.getItem(this.getMatterStorageKey());
      if (cache) {
        const data = JSON.parse(cache);
        this.matterTimeLimits = Array.isArray(data.timeLimits) ? data.timeLimits : [];
        this.matterTodos = Array.isArray(data.todos) ? data.todos : [];
        this.matterSchedules = Array.isArray(data.schedules) ? data.schedules : [];
        return;
      }
    } catch (e) {
      console.error('Failed to load matter data:', e);
    }

    this.matterTimeLimits = [
      { name: '重要事项', value: '30', endDate: this.getTodayIsoDate() }
    ];
    this.matterTodos = [
      { name: '新待办', extra: '中' }
    ];
    this.matterSchedules = [
      { itemclass: '日程', activity: '新活动' }
    ];
  }

  saveMatterData() {
    try {
      localStorage.setItem(this.getMatterStorageKey(), JSON.stringify({
        timeLimits: this.matterTimeLimits,
        todos: this.matterTodos,
        schedules: this.matterSchedules
      }));
    } catch (e) {
      console.error('Failed to save matter data:', e);
    }
  }

  renderMatterTables() {
    const limitBody = document.querySelector('#matter-limit-table tbody');
    const todoBody = document.querySelector('#matter-todo-table tbody');
    const scheduleBody = document.querySelector('#matter-schedule-table tbody');

    if (limitBody) {
      limitBody.innerHTML = this.matterTimeLimits.map((item, index) => `
        <tr>
          <td><input type="text" value="${this.escapeHtml(item.name)}" data-matter-type="limit" data-matter-index="${index}" data-matter-field="name"></td>
          <td><input type="number" min="0" max="999" value="${this.escapeHtml(item.value)}" data-matter-type="limit" data-matter-index="${index}" data-matter-field="value"></td>
          <td><input type="date" value="${this.escapeHtml(item.endDate)}" data-matter-type="limit" data-matter-index="${index}" data-matter-field="endDate"></td>
          <td><button class="matter-delete" data-matter-delete="limit" data-matter-index="${index}">删</button></td>
        </tr>
      `).join('');
    }

    if (todoBody) {
      todoBody.innerHTML = this.matterTodos.map((item, index) => `
        <tr>
          <td><input type="text" value="${this.escapeHtml(item.name)}" data-matter-type="todo" data-matter-index="${index}" data-matter-field="name"></td>
          <td>
            <select data-matter-type="todo" data-matter-index="${index}" data-matter-field="extra">
              <option value="高" ${item.extra === '高' ? 'selected' : ''}>高</option>
              <option value="中" ${item.extra === '中' ? 'selected' : ''}>中</option>
              <option value="低" ${item.extra === '低' ? 'selected' : ''}>低</option>
            </select>
          </td>
          <td><button class="matter-delete" data-matter-delete="todo" data-matter-index="${index}">删</button></td>
        </tr>
      `).join('');
    }

    if (scheduleBody) {
      scheduleBody.innerHTML = this.matterSchedules.map((item, index) => `
        <tr>
          <td><input type="text" value="${this.escapeHtml(item.itemclass)}" data-matter-type="schedule" data-matter-index="${index}" data-matter-field="itemclass"></td>
          <td><input type="text" value="${this.escapeHtml(item.activity)}" data-matter-type="schedule" data-matter-index="${index}" data-matter-field="activity"></td>
          <td><button class="matter-delete" data-matter-delete="schedule" data-matter-index="${index}">删</button></td>
        </tr>
      `).join('');
    }

    document.querySelectorAll('[data-matter-type]').forEach(input => {
      input.addEventListener('change', (e) => {
        this.updateMatterItem(
          e.target.getAttribute('data-matter-type'),
          parseInt(e.target.getAttribute('data-matter-index'), 10),
          e.target.getAttribute('data-matter-field'),
          e.target.value
        );
      });
    });

    document.querySelectorAll('[data-matter-delete]').forEach(button => {
      button.addEventListener('click', (e) => {
        this.deleteMatterItem(
          e.target.getAttribute('data-matter-delete'),
          parseInt(e.target.getAttribute('data-matter-index'), 10)
        );
      });
    });
  }

  addMatterTimeLimit() {
    this.matterTimeLimits.push({ name: '新时限项', value: '30', endDate: this.getTodayIsoDate() });
    this.saveMatterData();
    this.renderMatterTables();
  }

  addMatterTodo() {
    this.matterTodos.push({ name: '新待办', extra: '中' });
    this.saveMatterData();
    this.renderMatterTables();
  }

  addMatterSchedule() {
    this.matterSchedules.push({ itemclass: '日程', activity: '新活动' });
    this.saveMatterData();
    this.renderMatterTables();
  }

  updateMatterItem(type, index, field, value) {
    const groups = {
      limit: this.matterTimeLimits,
      todo: this.matterTodos,
      schedule: this.matterSchedules
    };
    const list = groups[type];
    if (!list || !list[index]) return;
    list[index][field] = value;
    this.saveMatterData();
  }

  deleteMatterItem(type, index) {
    const groups = {
      limit: this.matterTimeLimits,
      todo: this.matterTodos,
      schedule: this.matterSchedules
    };
    const list = groups[type];
    if (!list || !list[index]) return;
    list.splice(index, 1);
    this.saveMatterData();
    this.renderMatterTables();
  }

  clearMatterData() {
    if (!confirm('清空所有事项数据?')) return;
    this.matterTimeLimits = [];
    this.matterTodos = [];
    this.matterSchedules = [];
    this.saveMatterData();
    this.renderMatterTables();
  }

  calculateMatterDaysDiff(targetDateStr) {
    const targetDate = new Date(targetDateStr);
    if (Number.isNaN(targetDate.getTime())) return 0;
    const now = new Date();
    const timeDiff = targetDate - now;
    return Math.max(0, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
  }

  formatMatterDays(days) {
    if (days > 365) return `${Math.floor(days / 365)}年`;
    if (days > 90) return `${Math.floor(days / 30)}月`;
    return `${days}天`;
  }

  drawMatterRoundRect(x, y, width, height, radius, fillStyle, strokeStyle = '#000000', lineWidth = 1) {
    this.ctx.save();
    this.ctx.beginPath();
    if (typeof this.ctx.roundRect === 'function') {
      this.ctx.roundRect(x, y, width, height, radius);
    } else {
      const r = Math.min(radius, width / 2, height / 2);
      this.ctx.moveTo(x + r, y);
      this.ctx.lineTo(x + width - r, y);
      this.ctx.quadraticCurveTo(x + width, y, x + width, y + r);
      this.ctx.lineTo(x + width, y + height - r);
      this.ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
      this.ctx.lineTo(x + r, y + height);
      this.ctx.quadraticCurveTo(x, y + height, x, y + height - r);
      this.ctx.lineTo(x, y + r);
      this.ctx.quadraticCurveTo(x, y, x + r, y);
    }
    this.ctx.closePath();
    if (fillStyle) {
      this.ctx.fillStyle = fillStyle;
      this.ctx.fill();
    }
    if (strokeStyle) {
      this.ctx.strokeStyle = strokeStyle;
      this.ctx.lineWidth = lineWidth;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawMatterText(text, x, y, maxWidth, font, color = '#000000', align = 'left', baseline = 'top') {
    const value = String(text ?? '');
    this.ctx.save();
    this.ctx.font = font;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = baseline;

    let output = value;
    while (output.length > 1 && this.ctx.measureText(output).width > maxWidth) {
      output = output.slice(0, -1);
    }
    if (output !== value && output.length > 1) output = output.slice(0, -1) + '…';
    this.ctx.fillText(output, x, y);
    this.ctx.restore();
  }

  drawMatterInlineText(parts, centerX, y, font, baseline = 'middle') {
    this.ctx.save();
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = baseline;
    const totalWidth = parts.reduce((sum, part) => {
      this.ctx.font = part.font || font;
      return sum + this.ctx.measureText(part.text).width;
    }, 0);
    let x = centerX - totalWidth / 2;
    parts.forEach((part) => {
      this.ctx.font = part.font || font;
      this.ctx.fillStyle = part.color;
      this.ctx.fillText(part.text, x, y);
      x += this.ctx.measureText(part.text).width;
    });
    this.ctx.restore();
  }

  getMatterPalette() {
    const driverSelect = document.getElementById('epddriver');
    const selectedDriver = driverSelect?.options?.[driverSelect.selectedIndex];
    const mode = document.getElementById('ditherMode')?.value || selectedDriver?.getAttribute('data-color') || 'blackWhiteColor';

    const palettes = {
      blackWhiteColor: {
        modeLabel: '黑白',
        title: '#000000',
        dateNumber: '#000000',
        weekFill: '#000000',
        weekText: '#ffffff',
        todoHeaderFill: '#000000',
        todoHeaderText: '#ffffff',
        limitHeaderFill: '#000000',
        limitHeaderText: '#ffffff',
        scheduleHeaderFill: '#000000',
        scheduleHeaderText: '#ffffff',
        priorityHighText: '#000000',
        overflowText: '#000000',
        urgentFill: '#000000',
        urgentText: '#ffffff',
        normalChipFill: '#000000',
        normalChipText: '#ffffff',
        scheduleClassText: '#000000'
      },
      threeColor: {
        modeLabel: '黑白红',
        title: '#cc0000',
        dateNumber: '#cc0000',
        weekFill: '#cc0000',
        weekText: '#ffffff',
        todoHeaderFill: '#cc0000',
        todoHeaderText: '#ffffff',
        limitHeaderFill: '#000000',
        limitHeaderText: '#ffffff',
        scheduleHeaderFill: '#cc0000',
        scheduleHeaderText: '#ffffff',
        priorityHighText: '#cc0000',
        overflowText: '#cc0000',
        urgentFill: '#cc0000',
        urgentText: '#ffffff',
        normalChipFill: '#000000',
        normalChipText: '#ffffff',
        scheduleClassText: '#cc0000'
      },
      fourColor: {
        modeLabel: '黑白红黄',
        title: '#cc0000',
        dateNumber: '#cc0000',
        weekFill: '#ffff00',
        weekText: '#000000',
        todoHeaderFill: '#cc0000',
        todoHeaderText: '#ffffff',
        limitHeaderFill: '#ffff00',
        limitHeaderText: '#000000',
        scheduleHeaderFill: '#000000',
        scheduleHeaderText: '#ffffff',
        priorityHighText: '#cc0000',
        overflowText: '#cc0000',
        urgentFill: '#cc0000',
        urgentText: '#ffffff',
        normalChipFill: '#ffff00',
        normalChipText: '#000000',
        scheduleClassText: '#cc0000'
      },
      sixColor: {
        modeLabel: '六色',
        title: '#0000ff',
        dateNumber: '#cc0000',
        weekFill: '#ffff00',
        weekText: '#000000',
        todoHeaderFill: '#29cc14',
        todoHeaderText: '#000000',
        limitHeaderFill: '#ffff00',
        limitHeaderText: '#000000',
        scheduleHeaderFill: '#0000ff',
        scheduleHeaderText: '#ffffff',
        priorityHighText: '#cc0000',
        overflowText: '#0000ff',
        urgentFill: '#cc0000',
        urgentText: '#ffffff',
        normalChipFill: '#29cc14',
        normalChipText: '#000000',
        scheduleClassText: '#0000ff'
      }
    };

    return palettes[mode] || palettes.blackWhiteColor;
  }

  getMatterTemplateInset() {
    const driver = (document.getElementById('epddriver')?.value || '').toLowerCase();
    if (driver === '10' || driver === '11' || driver === '13') {
      return { x: 5, y: 5 };
    }
    return { x: 0, y: 0 };
  }

  drawMatterTemplateBase() {
    const palette = this.getMatterPalette();
    const black = '#000000';
    const fontFamily = `"${this.getSharedFontFamily()}", "Microsoft YaHei", "SimHei", sans-serif`;
    const now = new Date();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, 400, 300);

    this.drawMatterRoundRect(8, 8, 384, 40, 5, '#ffffff', black);
    this.ctx.strokeStyle = black;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(205, 12);
    this.ctx.lineTo(205, 44);
    this.ctx.stroke();
    const dateNumberFont = `bold 21px ${fontFamily}`;
    const dateUnitFont = `bold 14px ${fontFamily}`;
    this.drawMatterInlineText([
      { text: String(now.getFullYear()), color: palette.dateNumber, font: dateNumberFont },
      { text: '年', color: black, font: dateUnitFont },
      { text: String(now.getMonth() + 1), color: palette.dateNumber, font: dateNumberFont },
      { text: '月', color: black, font: dateUnitFont },
      { text: String(now.getDate()), color: palette.dateNumber, font: dateNumberFont },
      { text: '日', color: black, font: dateUnitFont }
    ], 74, 28, dateUnitFont);
    this.drawMatterRoundRect(156, 19, 42, 19, 3, palette.weekFill, palette.weekFill);
    this.drawMatterText(weekDays[now.getDay()], 177, 28, 36, `bold 13px ${fontFamily}`, palette.weekText, 'center', 'middle');
    this.drawMatterText('事项看板', 298, 28, 168, `bold 26px ${fontFamily}`, palette.title, 'center', 'middle');

    const sortedLimits = [...this.matterTimeLimits].sort((a, b) => {
      return this.calculateMatterDaysDiff(a.endDate) - this.calculateMatterDaysDiff(b.endDate);
    });

    const contentTop = 54;
    const contentBottom = 292;
    const gap = 8;
    const scheduleRowsWanted = Math.max(1, this.matterSchedules.length);
    const scheduleHeight = Math.max(46, Math.min(112, 28 + scheduleRowsWanted * 22));
    const topHeight = contentBottom - contentTop - gap - scheduleHeight;
    const topHeaderHeight = 24;
    const topBodyY = contentTop + topHeaderHeight + 6;
    const topBodyHeight = topHeight - topHeaderHeight - 10;

    this.drawMatterRoundRect(8, contentTop, 228, topHeight, 4, '#ffffff', black);
    this.drawMatterRoundRect(8, contentTop, 228, topHeaderHeight, 3, palette.todoHeaderFill, palette.todoHeaderFill);
    this.drawMatterText('待办事项', 122, contentTop + 3, 210, `bold 18px ${fontFamily}`, palette.todoHeaderText, 'center');

    const todoRowHeight = Math.max(14, Math.min(24, Math.floor(topBodyHeight / Math.max(1, this.matterTodos.length))));
    const todoFontSize = Math.max(11, Math.min(17, todoRowHeight - 5));
    const visibleTodoCount = Math.min(this.matterTodos.length, Math.floor(topBodyHeight / todoRowHeight));
    const visibleTodos = this.matterTodos.slice(0, visibleTodoCount);
    visibleTodos.forEach((item, index) => {
      const y = topBodyY + index * todoRowHeight;
      this.ctx.strokeStyle = black;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(14, y + todoRowHeight - 3);
      this.ctx.lineTo(230, y + todoRowHeight - 3);
      this.ctx.stroke();
      this.drawMatterText(item.name, 16, y + 1, 154, `bold ${todoFontSize}px ${fontFamily}`, black);
      this.drawMatterText(item.extra, 226, y + 1, 48, `bold ${todoFontSize}px ${fontFamily}`, item.extra === '高' ? palette.priorityHighText : black, 'right');
    });
    if (this.matterTodos.length > visibleTodos.length) {
      this.drawMatterText(`+${this.matterTodos.length - visibleTodos.length}项`, 226, contentTop + topHeight - 17, 60, `bold 12px ${fontFamily}`, palette.overflowText, 'right');
    }

    this.drawMatterRoundRect(244, contentTop, 148, topHeight, 4, '#ffffff', black);
    this.drawMatterRoundRect(244, contentTop, 148, topHeaderHeight, 3, palette.limitHeaderFill, palette.limitHeaderFill);
    this.drawMatterText('限时事项', 318, contentTop + 3, 130, `bold 17px ${fontFamily}`, palette.limitHeaderText, 'center');

    const limitRowHeight = Math.max(18, Math.min(29, Math.floor(topBodyHeight / Math.max(1, sortedLimits.length))));
    const limitFontSize = Math.max(11, Math.min(14, limitRowHeight - 10));
    const visibleLimitCount = Math.min(sortedLimits.length, Math.floor(topBodyHeight / limitRowHeight));
    const visibleLimits = sortedLimits.slice(0, visibleLimitCount);
    visibleLimits.forEach((item, index) => {
      const y = topBodyY + index * limitRowHeight;
      const days = this.calculateMatterDaysDiff(item.endDate);
      const ahead = parseInt(item.value, 10) || 0;
      const urgent = days <= ahead;
      const chipHeight = Math.max(14, limitRowHeight - 6);
      const chipFill = urgent ? palette.urgentFill : palette.normalChipFill;
      const chipText = urgent ? palette.urgentText : palette.normalChipText;
      this.drawMatterRoundRect(249, y, 138, limitRowHeight - 3, 3, '#ffffff', black);
      this.drawMatterRoundRect(252, y + 3, 66, chipHeight, 2, chipFill, chipFill);
      this.drawMatterText(item.name, 285, y + 5, 60, `bold ${limitFontSize}px ${fontFamily}`, chipText, 'center');
      this.drawMatterText(this.formatMatterDays(days), 384, y + 5, 62, `bold ${Math.min(14, limitFontSize + 1)}px ${fontFamily}`, urgent ? palette.priorityHighText : black, 'right');
    });
    if (sortedLimits.length > visibleLimits.length) {
      this.drawMatterText(`+${sortedLimits.length - visibleLimits.length}项`, 384, contentTop + topHeight - 17, 62, `bold 12px ${fontFamily}`, palette.overflowText, 'right');
    }

    const scheduleY = contentTop + topHeight + gap;
    const scheduleHeaderHeight = 20;
    const scheduleBodyY = scheduleY + scheduleHeaderHeight + 5;
    const scheduleBodyHeight = scheduleHeight - scheduleHeaderHeight - 8;
    this.drawMatterRoundRect(8, scheduleY, 384, scheduleHeight, 4, '#ffffff', black);
    this.drawMatterRoundRect(8, scheduleY, 384, scheduleHeaderHeight, 3, palette.scheduleHeaderFill, palette.scheduleHeaderFill);
    this.drawMatterText('今日日程', 200, scheduleY + 2, 360, `bold 15px ${fontFamily}`, palette.scheduleHeaderText, 'center');
    const scheduleRowHeight = Math.max(16, Math.min(22, Math.floor(scheduleBodyHeight / Math.max(1, this.matterSchedules.length))));
    const scheduleFontSize = Math.max(11, Math.min(15, scheduleRowHeight - 5));
    const visibleScheduleCount = Math.min(this.matterSchedules.length, Math.floor(scheduleBodyHeight / scheduleRowHeight));
    const visibleSchedules = this.matterSchedules.slice(0, visibleScheduleCount);
    visibleSchedules.forEach((item, index) => {
      const y = scheduleBodyY + index * scheduleRowHeight;
      this.ctx.strokeStyle = black;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(14, y + scheduleRowHeight - 3);
      this.ctx.lineTo(386, y + scheduleRowHeight - 3);
      this.ctx.stroke();
      this.drawMatterText(item.itemclass, 16, y + 1, 96, `bold ${scheduleFontSize}px ${fontFamily}`, palette.scheduleClassText);
      this.drawMatterText(item.activity, 116, y + 1, 228, `${scheduleFontSize}px ${fontFamily}`, black);
    });
    if (this.matterSchedules.length > visibleSchedules.length) {
      this.drawMatterText(`+${this.matterSchedules.length - visibleSchedules.length}项`, 384, scheduleY + scheduleHeight - 17, 44, `bold 12px ${fontFamily}`, palette.overflowText, 'right');
    }
  }

  renderMatterTemplateToCanvas(options = {}) {
    const saveHistory = options.saveHistory !== false;
    const silent = options.silent === true;
    const ditherAlg = document.getElementById('ditherAlg');
    if (ditherAlg) ditherAlg.value = 'none';
    this.clearElements();
    this.ctx.save();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.scale(this.canvas.width / 400, this.canvas.height / 300);
    const inset = this.getMatterTemplateInset();
    if (inset.x > 0 || inset.y > 0) {
      this.ctx.translate(inset.x, inset.y);
      this.ctx.scale((400 - inset.x * 2) / 400, (300 - inset.y * 2) / 300);
    }
    this.drawMatterTemplateBase();
    this.ctx.restore();
    this.matterTemplateRendered = true;
    if (saveHistory) this.saveToHistory();
    this.markCanvasChanged();
    if (!silent && typeof addLog === 'function') addLog('事项模板已绘制到画布');
  }

  refreshMatterTemplatePalette() {
    if (!this.matterTemplateRendered) return;
    this.renderMatterTemplateToCanvas({ saveHistory: false, silent: true });
    if (typeof addLog === 'function') addLog('事项模板配色已按当前屏幕颜色刷新');
  }

  clearElements() {
    this.textElements = [];
    this.lineSegments = [];
    this.todoItems = [];
    this.scheduleData = null;
    this.scheduleCellFontSizes = null;
    this.scheduleBaseImageData = null;
    this.selectedTextElement = null;
    this.selectedTodoItem = null;
  }
}
