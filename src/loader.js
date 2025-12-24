/**
 * Main loader entry point. Dispatches to 16-bit PNG loader or generic browser loader.
 * @param {File} file 
 */
export async function loadimage16Bit(file) {
    if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
        return loadPng16Bit(file);
    } else {
        return loadGenericImage(file);
    }
}

async function loadGenericImage(file) {
    // For JPG, WebP, etc., use browser native decoder
    // This will result in 8-bit data, which we must upscale to 16-bit for uniformity
    const bmp = await createImageBitmap(file);
    const width = bmp.width;
    const height = bmp.height;

    // Draw to canvas to extract raw pixels
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const imgData = ctx.getImageData(0, 0, width, height);

    // Convert Uint8 (0-255) to Uint16 (0-65535)
    // Structure is RGBA
    const raw = imgData.data; // Uint8ClampedArray
    const count = width * height * 4;
    const data16 = new Uint16Array(count);

    for (let i = 0; i < count; i++) {
        data16[i] = raw[i] * 257;
    }

    return {
        width,
        height,
        data: data16,
        channels: 4,
        depth: 16, // Normalized
        originalDepth: 8
    };
}

async function loadPng16Bit(file) {
    const arrayBuffer = await file.arrayBuffer();

    // Dynamic import to prevent main-thread crash if CDN fails
    // Using esm.sh with bundle param to ensure deps like pako are included if needed
    let decode;
    try {
        const module = await import('https://esm.sh/fast-png@6.1.0?bundle');
        decode = module.decode;
    } catch (e) {
        console.error("Failed to load fast-png decoder:", e);
        alert("Error: Could not load PNG decoder library. Check internet connection or console.");
        throw e;
    }

    if (!decode) {
        // Fallback if import succeeded but decode is undefined?
        console.error("fast-png module loaded but decode is missing", module);
        alert("Error: PNG decoder library invalid.");
        throw new Error("Invalid PNG lib");
    }

    // Decode PNG
    // fast-png returns { width, height, data, depth, channels, text }
    const decoded = decode(arrayBuffer);

    let rawData = decoded.data;
    let bitDepth = decoded.depth;

    // Normalize to 16-bit if 8-bit
    // This allows using a single shader (usampler2D) and pipeline
    if (bitDepth === 8) {
        // Convert Uint8Array to Uint16Array (0-255 -> 0-65535)
        // Multiplier is 257 (0xFF * 257 = 0xFFFF)
        const count = rawData.length;
        const newData = new Uint16Array(count);
        for (let i = 0; i < count; i++) {
            newData[i] = rawData[i] * 257;
        }
        rawData = newData;
        bitDepth = 16;
        console.log("Converted 8-bit PNG to 16-bit for rendering");
    }

    return {
        width: decoded.width,
        height: decoded.height,
        data: rawData, // Always Uint16Array (or converted)
        channels: decoded.channels,
        depth: 16, // Always report 16 to renderer
        originalDepth: decoded.depth // Preserved for UI
    };
}
