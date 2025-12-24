import { GLRenderer } from './gl-renderer.js?v=10';
import { loadimage16Bit } from './loader.js?v=3';

console.log('Image Compare Pro (WebGL 16-bit) initialized');

// State
const state = {
    images: [], // { name, width, height, data, channels, depth }
    composition: { width: 0, height: 0 },
    mode: 'wipe',
    activeImages: [],
    wipe: {
        position: 0.5,
        direction: 'horizontal'
    },
    mask: {
        type: 'checker',
        size: 50,
        valueMult: 1
    },
    diff: {
        mult: 1
    },
    scalePreference: null,
    transform: {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        isDragging: false,
        lastX: 0,
        lastY: 0
    },
    isHoldingB: false,

    // Wipe Interaction State
    isDraggingWipe: false,
    isHoveringWipe: false
};

// Elements
const app = document.getElementById('app');
const uploadOverlay = document.getElementById('upload-overlay');
const fileInput = document.getElementById('file-input');
const dropZone = document.querySelector('.drop-zone');
const viewerContainer = document.getElementById('viewer-container');
const canvas = document.getElementById('compare-canvas');

// Initialize WebGL Renderer
let renderer;
try {
    renderer = new GLRenderer(canvas);
} catch (e) {
    alert("WebGL2 not supported!");
    console.error(e);
}

// Auto-resize canvas when container changes
new ResizeObserver(() => {
    if (!state.images.length) return;
    resizeCanvas();
}).observe(viewerContainer);

const resolutionModal = document.getElementById('resolution-modal');
const appFooter = document.getElementById('app-footer');
const standardActions = document.getElementById('standard-actions');
const mismatchActions = document.getElementById('mismatch-actions');

// Controls
const controlsPanel = document.querySelector('.controls');
const modeSelect = document.getElementById('mode-select');
const wipeSlider = document.getElementById('wipe-slider');
const wipeRadios = document.querySelectorAll('input[name="wipe-dir"]');
const maskTypeSelect = document.getElementById('mask-type');
const maskSizeSlider = document.getElementById('mask-size');
const maskValueSlider = document.getElementById('mask-value');
const maskValueResetBtn = document.getElementById('mask-value-reset');
const diffMultSlider = document.getElementById('diff-mult');
const diffResetBtn = document.getElementById('diff-reset');
const abBtn = document.getElementById('ab-toggle-btn');
const homeBtn = document.getElementById('home-btn');
const exportBtn = document.getElementById('export-btn');
const resetViewBtn = document.getElementById('reset-view-btn');
const zoom100Btn = document.getElementById('zoom-100-btn');

// Event Listeners
dropZone.addEventListener('click', (e) => {
    if (e.target !== fileInput) fileInput.click();
});
dropZone.addEventListener('dragenter', (e) => {
    console.log('Drag Enter');
    e.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault(); // Critical to allow dropping
});
dropZone.addEventListener('dragleave', (e) => {
    console.log('Drag Leave');
    dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', handleDrop);
fileInput.addEventListener('change', handleFileSelect);

modeSelect.addEventListener('change', (e) => {
    setMode(e.target.value);
});

wipeSlider.addEventListener('input', (e) => {
    state.wipe.position = e.target.value / 100;
    render();
});

wipeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        state.wipe.direction = e.target.value;
        render();
    });
});

maskTypeSelect.addEventListener('change', (e) => {
    state.mask.type = e.target.value;
    render();
});

maskSizeSlider.addEventListener('input', (e) => {
    state.mask.size = parseInt(e.target.value);
    render();
});

maskValueSlider.addEventListener('input', (e) => {
    state.mask.valueMult = parseFloat(e.target.value);
    render();
});

maskValueResetBtn.addEventListener('click', () => {
    state.mask.valueMult = 1;
    maskValueSlider.value = 1;
    render();
});

diffMultSlider.addEventListener('input', (e) => {
    state.diff.mult = parseFloat(e.target.value);
    render();
});

diffResetBtn.addEventListener('click', () => {
    state.diff.mult = 1;
    diffMultSlider.value = 1;
    render();
});

homeBtn.addEventListener('click', () => {
    location.reload();
});

exportBtn.addEventListener('click', exportImage);

resetViewBtn.addEventListener('click', resetView);
zoom100Btn.addEventListener('click', zoomTo100);

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    if (key === 'h') resetView();
    else if (key === '0') zoomTo100();
    else if (key === '1') setMode('wipe');
    else if (key === '2') setMode('ab');
    else if (key === '3') setMode('diff');
    else if (key === '4') setMode('mask');
});

function resetView() {
    if (!state.composition.width) return;
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const compW = state.composition.width;
    const compH = state.composition.height;
    const scaleX = canvasW / compW;
    const scaleY = canvasH / compH;
    const fitScale = Math.min(scaleX, scaleY) * 0.9;
    state.transform.scale = fitScale;
    state.transform.offsetX = (canvasW - compW * fitScale) / 2;
    state.transform.offsetY = (canvasH - compH * fitScale) / 2;
    render();
}

function zoomTo100() {
    state.transform.scale = 1;
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const compW = state.composition.width;
    const compH = state.composition.height;
    state.transform.offsetX = (canvasW - compW) / 2;
    state.transform.offsetY = (canvasH - compH) / 2;
    render();
}

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
    const newScale = state.transform.scale + delta;
    if (newScale >= 0.01 && newScale <= 50) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        state.transform.offsetX -= (mouseX - state.transform.offsetX) * (delta / state.transform.scale);
        state.transform.offsetY -= (mouseY - state.transform.offsetY) * (delta / state.transform.scale);
        state.transform.scale = newScale;
        render();
    }
});

// Helper to get normalized mouse coordinate (0-1) relative to canvas
function getNormalizedMouse(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
}

canvas.addEventListener('mousedown', (e) => {
    // If hovering wipe line in wipe mode, start drag wipe
    if (state.mode === 'wipe' && state.isHoveringWipe) {
        state.isDraggingWipe = true;
        canvas.style.cursor = state.wipe.direction === 'horizontal' ? 'col-resize' : 'row-resize';
        return;
    }

    state.transform.isDragging = true;
    state.transform.lastX = e.clientX;
    state.transform.lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
    if (state.isDraggingWipe) {
        // Dragging Wipe Line
        const norm = getNormalizedMouse(e);
        state.wipe.position = state.wipe.direction === 'horizontal' ? norm.x : norm.y;

        // Sync slider
        wipeSlider.value = Math.floor(state.wipe.position * 100);

        render();
        return;
    }

    if (state.transform.isDragging) {
        // Pan Logic
        const dx = e.clientX - state.transform.lastX;
        const dy = e.clientY - state.transform.lastY;
        state.transform.offsetX += dx;
        state.transform.offsetY += dy;
        state.transform.lastX = e.clientX;
        state.transform.lastY = e.clientY;
        render();
        return;
    }

    // Hover Detection for Wipe Line
    if (state.mode === 'wipe' && !state.transform.isDragging) { // Only if not panning
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate wipe pos in pixels
        const wipePosPx = state.wipe.direction === 'horizontal'
            ? state.wipe.position * rect.width
            : state.wipe.position * rect.height;

        const mousePosPx = state.wipe.direction === 'horizontal' ? mouseX : mouseY;

        const dist = Math.abs(mousePosPx - wipePosPx);
        const threshold = 15; // px

        if (dist < threshold) {
            state.isHoveringWipe = true;
            canvas.style.cursor = state.wipe.direction === 'horizontal' ? 'col-resize' : 'row-resize';
        } else {
            state.isHoveringWipe = false;
            canvas.style.cursor = 'default';
        }
    } else {
        state.isHoveringWipe = false;
        if (!state.transform.isDragging) canvas.style.cursor = 'default';
    }
});

window.addEventListener('mouseup', () => {
    state.transform.isDragging = false;
    state.isDraggingWipe = false;

    // Reset cursor based on hover
    if (state.mode === 'wipe' && state.isHoveringWipe) {
        canvas.style.cursor = state.wipe.direction === 'horizontal' ? 'col-resize' : 'row-resize';
    } else {
        canvas.style.cursor = 'default';
    }
});

abBtn.addEventListener('mousedown', () => { state.isHoldingB = true; render(); });
abBtn.addEventListener('mouseup', () => { state.isHoldingB = false; render(); });
abBtn.addEventListener('mouseleave', () => { state.isHoldingB = false; render(); });

resolutionModal.addEventListener('close', () => {
    state.scalePreference = resolutionModal.returnValue;
    processImages();
});

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(f.name));
    if (files.length > 0) loadImages(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length > 0) loadImages(files);
}

function updateStatus(msg) {
    const h2 = dropZone.querySelector('h2');
    if (h2) h2.textContent = msg;
    console.log(`[Status] ${msg}`);
}

async function loadImages(files) {
    state.images = [];
    appFooter.classList.add('hidden');

    updateStatus("Loading 16-bit decoder...");

    const promises = files.slice(0, 2).map(async (file) => {
        updateStatus(`Decoding ${file.name}...`);
        try {
            const imgData = await loadimage16Bit(file);
            console.log(`Decoded ${file.name}:`, imgData);
            return { ...imgData, name: file.name };
        } catch (e) {
            console.error(`Failed to decode ${file.name}`, e);
            throw e;
        }
    });

    try {
        const loadedImages = await Promise.all(promises);
        state.images = loadedImages;

        updateStatus("Uploading to GPU...");
        if (state.images.length === 2) {
            renderer.uploadImage(0, state.images[0]);
            renderer.uploadImage(1, state.images[1]);

            updateStatus("Processing...");
            checkResolution();
        } else {
            alert('Please select 2 images');
            updateStatus("Drag & Drop Images");
        }
    } catch (err) {
        console.error("Load failed", err);
        alert("Failed to load images. See console for details.\n" + err.message);
        updateStatus("Error Loading Images");
    }
}

function checkResolution() {
    const [img1, img2] = state.images;
    const ar1 = img1.width / img1.height;
    const ar2 = img2.width / img2.height;
    const arDiff = Math.abs(ar1 - ar2);
    const mismatch = arDiff > 0.01;

    if (mismatch) {
        standardActions.classList.add('hidden');
        mismatchActions.classList.remove('hidden');
        resolutionModal.showModal();
    } else if (img1.width !== img2.width || img1.height !== img2.height) {
        mismatchActions.classList.add('hidden');
        standardActions.classList.remove('hidden');
        resolutionModal.showModal();
    } else {
        state.scalePreference = 'no-scale';
        processImages();
    }
}

const fileNameA = document.getElementById('file-name-a');
const fileNameB = document.getElementById('file-name-b');

function processImages() {
    uploadOverlay.classList.add('hidden');
    viewerContainer.classList.remove('hidden');
    appFooter.classList.remove('hidden');

    if (state.images.length >= 2) {
        fileNameA.textContent = `${state.images[0].name} (${state.images[0].originalDepth}-bit)`;
        fileNameB.textContent = `${state.images[1].name} (${state.images[1].originalDepth}-bit)`;
    }

    calculateComposition();
    resizeCanvas();
    resetView();
}

function calculateComposition() {
    if (state.images.length < 2) return;
    const [img1, img2] = state.images;

    // Reset scales
    img1.scaleX = 1; img1.scaleY = 1;
    img2.scaleX = 1; img2.scaleY = 1;

    let targetW = img1.width;
    let targetH = img1.height;

    let compW = Math.max(img1.width, img2.width);
    let compH = Math.max(img1.height, img2.height);

    if (state.scalePreference === 'match-width') {
        const w1 = img1.width;
        const w2 = img2.width;
        if (w1 < w2) {
            const s = w2 / w1;
            img1.scaleX = s; img1.scaleY = s;
        } else if (w2 < w1) {
            const s = w1 / w2;
            img2.scaleX = s; img2.scaleY = s;
        }
    } else if (state.scalePreference === 'match-height') {
        const h1 = img1.height;
        const h2 = img2.height;
        if (h1 < h2) {
            const s = h2 / h1;
            img1.scaleX = s; img1.scaleY = s;
        } else if (h2 < h1) {
            const s = h1 / h2;
            img2.scaleX = s; img2.scaleY = s;
        }
    } else if (state.scalePreference === 'scale-up-small') {
        const w1 = img1.width;
        const w2 = img2.width;
        if (w1 < w2) { // Scale 1 up
            const s = w2 / w1;
            img1.scaleX = s; img1.scaleY = s;
        } else if (w2 < w1) { // Scale 2 up
            const s = w1 / w2;
            img2.scaleX = s; img2.scaleY = s;
        }
    } else if (state.scalePreference === 'scale-down-large') {
        const w1 = img1.width;
        const w2 = img2.width;
        if (w1 > w2) { // Scale 1 down
            const s = w2 / w1;
            img1.scaleX = s; img1.scaleY = s;
        } else if (w2 > w1) { // Scale 2 down
            const s = w1 / w2;
            img2.scaleX = s; img2.scaleY = s;
        }
    }

    // Re-calculate effective size
    const effW1 = img1.width * img1.scaleX;
    const effH1 = img1.height * img1.scaleY;
    const effW2 = img2.width * img2.scaleX;
    const effH2 = img2.height * img2.scaleY;

    compW = Math.max(effW1, effW2);
    compH = Math.max(effH1, effH2);

    state.composition = {
        width: compW,
        height: compH
    };

    // Center Logic
    img1.offsetX = (compW - effW1) / 2;
    img1.offsetY = (compH - effH1) / 2;

    img2.offsetX = (compW - effW2) / 2;
    img2.offsetY = (compH - effH2) / 2;

    const minSize = Math.max(10, Math.floor(state.composition.width / 100));
    maskSizeSlider.min = minSize;
    maskSizeSlider.max = Math.floor(state.composition.width / 10);
    state.mask.size = Math.floor(state.composition.width / 20);
    maskSizeSlider.value = state.mask.size;
}

function resizeCanvas() {
    canvas.width = viewerContainer.clientWidth;
    canvas.height = viewerContainer.clientHeight;
    render();
}

function setMode(mode) {
    state.mode = mode;
    if (modeSelect.value !== mode) modeSelect.value = mode;

    document.getElementById('wipe-controls').classList.toggle('hidden', mode !== 'wipe');
    document.getElementById('mask-controls').classList.toggle('hidden', mode !== 'mask');
    document.getElementById('ab-controls').classList.toggle('hidden', mode !== 'ab');
    document.getElementById('diff-controls').classList.toggle('hidden', mode !== 'diff');

    exportBtn.disabled = (mode === 'ab'); // Export disabled for Toggle
    exportBtn.style.opacity = (mode === 'ab') ? '0.5' : '1';

    render();
}

function render() {
    if (renderer) renderer.render(state);
}

async function exportImage() {
    if (!state.composition.width || !renderer) return;

    updateStatus("Exporting...");

    // 1. Save current state
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    const originalTransform = { ...state.transform };

    // 2. Resize canvas into full resolution
    canvas.width = state.composition.width;
    canvas.height = state.composition.height;

    // 3. Reset View to cover full canvas (1:1)
    state.transform.scale = 1;
    state.transform.offsetX = 0;
    state.transform.offsetY = 0;

    // 4. Render
    render();

    // 5. Blob & Download
    // Using high quality JPEG or PNG
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Custom Filename: [basenameA]_[mode].png
        let filename = `compare-${Date.now()}.png`;
        if (state.images.length > 0 && state.images[0].name) {
            const base = state.images[0].name.replace(/\.[^/.]+$/, "");
            filename = `${base}_${state.mode}.png`;
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // 6. Restore State
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        state.transform = originalTransform;
        render(); // Restore view

        updateStatus("Export Complete");
    }, 'image/png');
}
