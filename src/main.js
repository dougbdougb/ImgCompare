console.log('Image Compare Pro initialized');

// State
const state = {
    images: [], // { name, url, element, width, height }
    composition: { width: 0, height: 0 }, // Virtual size of aligned images
    mode: 'wipe', // wipe, ab, diff, mask
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
    // showIndicators removed
    scalePreference: null, // 'scale-up-small', 'scale-down-large'
    transform: {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        isDragging: false,
        lastX: 0,
        lastY: 0
    }
};

// Elements
const app = document.getElementById('app');
const uploadOverlay = document.getElementById('upload-overlay');
const fileInput = document.getElementById('file-input');
const dropZone = document.querySelector('.drop-zone');
const viewerContainer = document.getElementById('viewer-container');
const canvas = document.getElementById('compare-canvas');
const ctx = canvas.getContext('2d');
const resolutionModal = document.getElementById('resolution-modal');
const appFooter = document.getElementById('app-footer');

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
const abBtn = document.getElementById('ab-toggle-btn');
// const showIndicatorsCheckbox removed
const homeBtn = document.getElementById('home-btn');
const exportBtn = document.getElementById('export-btn');
const resetViewBtn = document.getElementById('reset-view-btn');
const zoom100Btn = document.getElementById('zoom-100-btn');

// Event Listeners
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
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

homeBtn.addEventListener('click', () => {
    location.reload();
});

exportBtn.addEventListener('click', exportImage);

resetViewBtn.addEventListener('click', resetView);
zoom100Btn.addEventListener('click', zoomTo100);

window.addEventListener('keydown', (e) => {
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key.toLowerCase();

    if (key === 'h') {
        resetView();
    } else if (key === '0') {
        zoomTo100();
    } else if (key === '1') {
        setMode('wipe');
    } else if (key === '2') {
        setMode('ab');
    } else if (key === '3') {
        setMode('diff');
    } else if (key === '4') {
        setMode('mask');
    }
});

function resetView() {
    if (!state.composition.width) return;

    // Fit composition to canvas
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const compW = state.composition.width;
    const compH = state.composition.height;

    const scaleX = canvasW / compW;
    const scaleY = canvasH / compH;
    const fitScale = Math.min(scaleX, scaleY) * 0.9; // 90% fit for padding

    state.transform.scale = fitScale;

    // Center
    state.transform.offsetX = (canvasW - compW * fitScale) / 2;
    state.transform.offsetY = (canvasH - compH * fitScale) / 2;

    render();
}

function zoomTo100() {
    state.transform.scale = 1;

    // Center based on 1:1 scale
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const compW = state.composition.width;
    const compH = state.composition.height;

    state.transform.offsetX = (canvasW - compW) / 2;
    state.transform.offsetY = (canvasH - compH) / 2;

    render();
}

// Zoom & Pan
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
    const newScale = state.transform.scale + delta;

    // Limit zoom
    if (newScale >= 0.01 && newScale <= 50) { // Expanded range
        // Zoom towards mouse pointer
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate offset adjustment to keep mouse point stable
        state.transform.offsetX -= (mouseX - state.transform.offsetX) * (delta / state.transform.scale);
        state.transform.offsetY -= (mouseY - state.transform.offsetY) * (delta / state.transform.scale);

        state.transform.scale = newScale;
        render();
    }
});

canvas.addEventListener('mousedown', (e) => {
    state.transform.isDragging = true;
    state.transform.lastX = e.clientX;
    state.transform.lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
    if (state.transform.isDragging) {
        const dx = e.clientX - state.transform.lastX;
        const dy = e.clientY - state.transform.lastY;

        state.transform.offsetX += dx;
        state.transform.offsetY += dy;

        state.transform.lastX = e.clientX;
        state.transform.lastY = e.clientY;

        render();
    }
});

window.addEventListener('mouseup', () => {
    state.transform.isDragging = false;
    canvas.style.cursor = 'default';
});

// A/B Hold
let isHoldingB = false;
abBtn.addEventListener('mousedown', () => { isHoldingB = true; render(); });
abBtn.addEventListener('mouseup', () => { isHoldingB = false; render(); });
abBtn.addEventListener('mouseleave', () => { isHoldingB = false; render(); });

// Resolution Modal
resolutionModal.addEventListener('close', () => {
    state.scalePreference = resolutionModal.returnValue;
    processImages();
});

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) loadImages(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length > 0) loadImages(files);
}

async function loadImages(files) {
    state.images = [];
    const promises = files.slice(0, 2).map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve({
                    name: file.name,
                    url: e.target.result,
                    element: img,
                    width: img.width,
                    height: img.height
                });
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    });

    const loadedImages = await Promise.all(promises);
    state.images = loadedImages;

    if (state.images.length === 2) {
        checkResolution();
    } else {
        alert('Please select 2 images');
    }
}

function checkResolution() {
    const [img1, img2] = state.images;
    if (img1.width !== img2.width || img1.height !== img2.height) {
        resolutionModal.showModal();
    } else {
        processImages();
    }
}

const fileNameA = document.getElementById('file-name-a');
const fileNameB = document.getElementById('file-name-b');

function processImages() {
    uploadOverlay.classList.add('hidden');
    viewerContainer.classList.remove('hidden');
    appFooter.classList.remove('hidden');

    // Update File Info
    if (state.images.length >= 2) {
        fileNameA.textContent = state.images[0].name;
        fileNameB.textContent = state.images[1].name;
    }

    // Calculate Relative Scales and Composition Size
    calculateComposition();

    // Initial Resize and Fit
    resizeCanvas();
    resetView();
}

function calculateComposition() {
    if (state.images.length < 2) return;
    const [img1, img2] = state.images;

    // Determine target dimensions for alignment
    let targetWidth = img1.width;
    let targetHeight = img1.height;

    if (state.scalePreference === 'scale-up-small') {
        if (img1.width < img2.width) {
            targetWidth = img2.width;
            targetHeight = img2.height;
        }
    } else if (state.scalePreference === 'scale-down-large') {
        if (img1.width > img2.width) {
            targetWidth = img2.width;
            targetHeight = img2.height;
        }
    }

    // Store relative scales to match target dimensions
    state.scales = {
        img1: targetWidth / img1.width,
        img2: targetWidth / img2.width
    };

    // Composition size is the target size
    state.composition = {
        width: targetWidth,
        height: targetHeight
    };

    // Update mask slider range based on composition width
    const minSize = Math.max(10, Math.floor(targetWidth / 100));
    const maxSize = Math.floor(targetWidth / 10);
    maskSizeSlider.min = minSize;
    maskSizeSlider.max = maxSize;

    // Auto-scale size to 1/20th of image width
    state.mask.size = Math.floor(targetWidth / 20);

    // Clamp to range just in case
    if (state.mask.size < minSize) state.mask.size = minSize;
    if (state.mask.size > maxSize) state.mask.size = maxSize;

    maskSizeSlider.value = state.mask.size;
}

function resizeCanvas() {
    // Canvas fills the container
    canvas.width = viewerContainer.clientWidth;
    canvas.height = viewerContainer.clientHeight;
    render();
}

function calculateScale(img, targetW, targetH) {
    return targetW / img.width;
}

function setMode(mode) {
    state.mode = mode;

    // Update UI
    if (modeSelect.value !== mode) {
        modeSelect.value = mode;
    }

    document.getElementById('wipe-controls').classList.toggle('hidden', mode !== 'wipe');
    document.getElementById('mask-controls').classList.toggle('hidden', mode !== 'mask');
    document.getElementById('ab-controls').classList.toggle('hidden', mode !== 'ab');
    document.getElementById('diff-controls').classList.toggle('hidden', mode !== 'diff');

    // Disable Export in Toggle (A/B) mode
    exportBtn.disabled = (mode === 'ab');
    if (mode === 'ab') {
        exportBtn.title = "Export not available in Toggle mode";
        exportBtn.style.opacity = '0.5';
        exportBtn.style.cursor = 'not-allowed';
    } else {
        exportBtn.title = "";
        exportBtn.style.opacity = '1';
        exportBtn.style.cursor = 'pointer';
    }

    render();
}

function render() {
    drawScene(ctx, canvas.width, canvas.height, true);
}

function drawScene(context, w, h, applyTransform, patternSizeOverride = null) {
    try {
        if (state.images.length < 2 || !state.scales) return;

        const [img1, img2] = state.images;

        context.clearRect(0, 0, w, h);

        // Helper to draw an image scaled to composition size
        const drawScaled = (img, scale) => {
            context.drawImage(img, 0, 0, img.width * scale, img.height * scale);
        };

        // --- LAYER 1: Base Image ---
        context.save(); // SAVE 1: Transform

        if (applyTransform) {
            context.translate(state.transform.offsetX, state.transform.offsetY);
            context.scale(state.transform.scale, state.transform.scale);
        }

        // Draw Image 1 (Base)
        drawScaled(img1.element, state.scales.img1);

        // --- LAYER 2: Comparison Image ---
        context.save(); // SAVE 2: Mode specific state

        if (state.mode === 'wipe') {
            // We need to clip based on screen coordinates (or target coordinates), 
            // but draw in transformed coordinates.

            context.save(); // SAVE 3: Clip Setup
            context.setTransform(1, 0, 0, 1, 0, 0); // Identity
            context.beginPath();

            const wipeX = w * state.wipe.position;
            const wipeY = h * state.wipe.position;

            if (state.wipe.direction === 'horizontal') {
                context.rect(wipeX, 0, w, h);
            } else {
                context.rect(0, wipeY, w, h);
            }
            context.clip();

            // We cannot use restore() here because it would remove the clip.
            // We must manually re-apply the transform to draw the image in the correct place.
            if (applyTransform) {
                context.translate(state.transform.offsetX, state.transform.offsetY);
                context.scale(state.transform.scale, state.transform.scale);
            }

            drawScaled(img2.element, state.scales.img2);

            context.restore(); // RESTORE 3: Remove clip and transform override

        } else if (state.mode === 'ab') {
            if (isHoldingB) {
                drawScaled(img2.element, state.scales.img2);
            }
        } else if (state.mode === 'diff') {
            context.globalCompositeOperation = 'difference';
            drawScaled(img2.element, state.scales.img2);

            // Note: Diff enhancement is handled AFTER restoring context

        } else if (state.mode === 'mask') {
            // 1. Create temp canvas matching target size.
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tCtx = tempCanvas.getContext('2d');

            // 2. Apply current transform to temp context
            if (applyTransform) {
                tCtx.translate(state.transform.offsetX, state.transform.offsetY);
                tCtx.scale(state.transform.scale, state.transform.scale);
            }

            // 3. Draw Img2 to temp
            if (state.mask.valueMult !== 1) {
                tCtx.filter = `brightness(${state.mask.valueMult})`;
            }
            tCtx.drawImage(img2.element, 0, 0, img2.width * state.scales.img2, img2.height * state.scales.img2);
            tCtx.filter = 'none';

            // 4. Mask with pattern (Screen/Target Space)
            tCtx.save();
            tCtx.setTransform(1, 0, 0, 1, 0, 0);
            tCtx.globalCompositeOperation = 'destination-in';

            // Use override size if provided, otherwise use state size
            const pSize = patternSizeOverride !== null ? patternSizeOverride : state.mask.size;
            drawPattern(tCtx, w, h, pSize);

            tCtx.restore();

            // 5. Draw temp to main
            context.restore(); // Pop SAVE 2 (Mode)
            context.restore(); // Pop SAVE 1 (Transform) - Now we are at Identity

            context.drawImage(tempCanvas, 0, 0);

            return;
        }

        context.restore(); // RESTORE 2: Mode
        context.restore(); // RESTORE 1: Transform

        // --- POST-PROCESSING (Screen/Target Space) ---

        if (state.mode === 'diff' && state.diff.mult !== 1) {
            // Apply brightness enhancement to the difference result
            const diffData = context.getImageData(0, 0, w, h);
            const tempC = document.createElement('canvas');
            tempC.width = w;
            tempC.height = h;
            tempC.getContext('2d').putImageData(diffData, 0, 0);

            context.clearRect(0, 0, w, h);
            context.filter = `brightness(${state.diff.mult})`;
            context.drawImage(tempC, 0, 0);
            context.filter = 'none';
        }

    } catch (e) {
        console.log('Render Error:', e);
        // Emergency cleanup
        context.globalCompositeOperation = 'source-over';
        context.filter = 'none';
        context.setTransform(1, 0, 0, 1, 0, 0);
    }
}

function exportImage() {
    if (state.images.length === 0) return;

    const imgAName = state.images[0].name;
    const basename = imgAName.substring(0, imgAName.lastIndexOf('.')) || imgAName;
    const mode = state.mode;

    // Create a temp canvas at full composition resolution
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = state.composition.width;
    exportCanvas.height = state.composition.height;
    const exportCtx = exportCanvas.getContext('2d');

    // Calculate pattern size to match visual appearance
    // P_export = P_screen / Zoom_screen
    const exportPatternSize = state.mask.size / state.transform.scale;

    // Draw without viewport transform (1:1 to composition)
    drawScene(exportCtx, exportCanvas.width, exportCanvas.height, false, exportPatternSize);

    const link = document.createElement('a');
    link.download = `${basename}_${mode}.png`;
    link.href = exportCanvas.toDataURL();
    link.click();
}

function drawPattern(ctx, w, h, size) {
    if (size <= 0) return;

    // Create a small pattern canvas
    const patternCanvas = document.createElement('canvas');
    const pCtx = patternCanvas.getContext('2d');

    if (state.mask.type === 'checker') {
        patternCanvas.width = size * 2;
        patternCanvas.height = size * 2;

        pCtx.fillStyle = '#000';
        pCtx.fillRect(0, 0, size, size);
        pCtx.fillRect(size, size, size, size);
    } else {
        // Stripes (Vertical)
        patternCanvas.width = size * 2;
        patternCanvas.height = size; // Height doesn't matter for vertical stripes pattern

        pCtx.fillStyle = '#000';
        pCtx.fillRect(0, 0, size, size);
    }

    const pattern = ctx.createPattern(patternCanvas, 'repeat');
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
}

window.addEventListener('resize', () => {
    // Handle resize
    resizeCanvas();
    // Re-center or keep relative position?
    // For now, just render.
    // Maybe reset view if it was fitted?
    // Let's just render.
});
