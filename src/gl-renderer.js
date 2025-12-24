export class GLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2');
        if (!this.gl) {
            throw new Error("WebGL2 not supported");
        }

        this.gl.getExtension('EXT_color_buffer_float');

        this.program = null;
        this.textures = [null, null];
        this.vao = null;

        this.init();
    }

    init() {
        const gl = this.gl;

        // VERTEXT SHADER
        const vsSource = `#version 300 es
        in vec2 a_position;
        in vec2 a_texCoord;
        out vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }`;

        // FRAGMENT SHADER
        const fsSource = `#version 300 es
        precision highp float;
        precision highp usampler2D;
        
        in vec2 v_texCoord;
        out vec4 outColor;
        
        uniform usampler2D u_imageA;
        uniform usampler2D u_imageB;
        
        uniform vec2 u_resA;
        uniform vec2 u_resB;
        uniform vec2 u_imgOffsetA; 
        uniform vec2 u_imgOffsetB; 
        uniform vec2 u_imgScaleA; // New: Scale for Image A
        uniform vec2 u_imgScaleB; // New: Scale for Image B

        uniform vec2 u_offset;
        uniform float u_scale;
        uniform vec2 u_canvasRes;
        
        // Mode: 0=Wipe, 1=Toggle, 2=Diff, 3=Mask
        uniform int u_mode; 
        uniform float u_wipePos;
        uniform int u_wipeDir;
        uniform float u_diffMult;
        
        uniform int u_maskType;
        uniform float u_maskSize;
        uniform float u_maskVal;

        uniform bool u_hasA;
        uniform bool u_hasB;
        
        uniform int u_toggleState; 

        vec4 sampleImage(usampler2D tex, vec2 originalRes, vec2 imgOffset, vec2 imgScale, vec2 uv) {
            vec2 screenCoord = uv * u_canvasRes;
            
            // 1. Transform Screen -> World (Composition Space)
            vec2 worldCoord = (screenCoord - u_offset) / u_scale;
            
            // 2. Transform World -> Image Local Space
            // Account for individual image offset AND scale.
            // Coord must be scaled relative to the image origin? usually top-left.
            // If scale is 2.0, then 1 unit of world space = 0.5 units of image space?
            // "Match Width": we display the image LARGER or SMALLER.
            // If we display it 2x larger, we march through its texture 0.5x as fast.
            // So: local = (world - offset) / internalScale
            
            vec2 imgLocal = (worldCoord - imgOffset) / imgScale;
            
            vec2 imgUV = imgLocal / originalRes;
            
            if (imgUV.x < 0.0 || imgUV.x > 1.0 || imgUV.y < 0.0 || imgUV.y > 1.0) {
                return vec4(0.0);
            }
            
            uvec4 raw = texture(tex, imgUV);
            return vec4(raw) / 65535.0;
        }

        float getMaskPattern(vec2 uv) {
            vec2 screenPos = uv * u_canvasRes;
            float size = u_maskSize;
            
            if (u_maskType == 0) { // Checker
                float x = floor(screenPos.x / size);
                float y = floor(screenPos.y / size);
                return mod(x + y, 2.0);
            } else { // Stripes
                 float x = floor(screenPos.x / size);
                 return mod(x, 2.0);
            }
        }

        void main() {
            vec4 colA = u_hasA ? sampleImage(u_imageA, u_resA, u_imgOffsetA, u_imgScaleA, v_texCoord) : vec4(0.0);
            vec4 colB = u_hasB ? sampleImage(u_imageB, u_resB, u_imgOffsetB, u_imgScaleB, v_texCoord) : vec4(0.0);

            vec3 finalColor = vec3(0.0);
            float finalAlpha = 1.0;

            if (u_mode == 0) { // WIPE
                bool showB = false;
                if (u_wipeDir == 0) { // Horz
                    if (v_texCoord.x > u_wipePos) showB = true;
                } else { // Vert
                    if (v_texCoord.y > u_wipePos) showB = true;
                }
                
                if (showB) {
                    finalColor = colB.rgb;
                    finalAlpha = colB.a;
                } else {
                    finalColor = colA.rgb;
                    finalAlpha = colA.a;
                }
                
                // Wipe Line
                float dist = 0.0;
                if (u_wipeDir == 0) dist = abs(v_texCoord.x - u_wipePos) * u_canvasRes.x;
                else dist = abs(v_texCoord.y - u_wipePos) * u_canvasRes.y;
                
                if (dist < 1.0) {
                     finalColor = vec3(0.2);
                     finalAlpha = 1.0;
                }

            } else if (u_mode == 1) { // TOGGLE
                if (u_toggleState == 1) {
                    finalColor = colB.rgb;
                    finalAlpha = colB.a;
                } else {
                    finalColor = colA.rgb;
                    finalAlpha = colA.a;
                }

            } else if (u_mode == 2) { // DIFF
                vec3 diff = abs(colA.rgb - colB.rgb);
                finalColor = diff * u_diffMult;
                finalAlpha = 1.0; 

            } else if (u_mode == 3) { // MASK
                vec3 valB = colB.rgb * u_maskVal;
                float pattern = getMaskPattern(v_texCoord);
                
                vec3 layerB = valB;
                float alphaB = colB.a * pattern; 
                
                finalColor = mix(colA.rgb, layerB, alphaB);
                finalAlpha = 1.0;
            }

            outColor = vec4(finalColor, finalAlpha);
        }`;

        const program = this.createProgram(gl, vsSource, fsSource);
        this.program = program;

        this.positionLoc = gl.getAttribLocation(program, 'a_position');
        this.texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');

        this.uniforms = {
            imageA: gl.getUniformLocation(program, 'u_imageA'),
            imageB: gl.getUniformLocation(program, 'u_imageB'),
            resA: gl.getUniformLocation(program, 'u_resA'),
            resB: gl.getUniformLocation(program, 'u_resB'),
            imgOffsetA: gl.getUniformLocation(program, 'u_imgOffsetA'),
            imgOffsetB: gl.getUniformLocation(program, 'u_imgOffsetB'),
            imgScaleA: gl.getUniformLocation(program, 'u_imgScaleA'),
            imgScaleB: gl.getUniformLocation(program, 'u_imgScaleB'),
            offset: gl.getUniformLocation(program, 'u_offset'),
            scale: gl.getUniformLocation(program, 'u_scale'),
            canvasRes: gl.getUniformLocation(program, 'u_canvasRes'),
            mode: gl.getUniformLocation(program, 'u_mode'),
            wipePos: gl.getUniformLocation(program, 'u_wipePos'),
            wipeDir: gl.getUniformLocation(program, 'u_wipeDir'),
            diffMult: gl.getUniformLocation(program, 'u_diffMult'),
            maskType: gl.getUniformLocation(program, 'u_maskType'),
            maskSize: gl.getUniformLocation(program, 'u_maskSize'),
            maskVal: gl.getUniformLocation(program, 'u_maskVal'),
            hasA: gl.getUniformLocation(program, 'u_hasA'),
            hasB: gl.getUniformLocation(program, 'u_hasB'),
            toggleState: gl.getUniformLocation(program, 'u_toggleState')
        };

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.positionLoc);
        gl.vertexAttribPointer(this.positionLoc, 2, gl.FLOAT, false, 0, 0);

        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 1, 1, 1, 0, 0,
            0, 0, 1, 1, 1, 0,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.texCoordLoc);
        gl.vertexAttribPointer(this.texCoordLoc, 2, gl.FLOAT, false, 0, 0);
    }

    createProgram(gl, vs, fs) {
        const createShader = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error(gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };
        const program = gl.createProgram();
        gl.attachShader(program, createShader(gl.VERTEX_SHADER, vs));
        gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    createTexture(imgData) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        // Robustness: Always convert to RGBA16
        // Many WebGL2 implementations have issues with RGB16UI or alignment
        let finalData = imgData.data;

        if (imgData.channels === 3) {
            const count = imgData.width * imgData.height;
            const newData = new Uint16Array(count * 4);
            const raw = imgData.data;
            for (let i = 0; i < count; i++) {
                newData[i * 4 + 0] = raw[i * 3 + 0];
                newData[i * 4 + 1] = raw[i * 3 + 1];
                newData[i * 4 + 2] = raw[i * 3 + 2];
                newData[i * 4 + 3] = 65535; // Opaque Alpha
            }
            finalData = newData;
        }

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA16UI, // Always use RGBA
            imgData.width,
            imgData.height,
            0,
            gl.RGBA_INTEGER,
            gl.UNSIGNED_SHORT,
            finalData
        );
        return tex;
    }

    uploadImage(slot, imgData) {
        if (this.textures[slot]) {
            this.gl.deleteTexture(this.textures[slot]);
        }
        this.textures[slot] = this.createTexture(imgData);
    }

    render(state) {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        if (this.textures[0]) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
            gl.uniform1i(this.uniforms.imageA, 0);
            gl.uniform1i(this.uniforms.hasA, 1);
            gl.uniform2f(this.uniforms.resA, state.images[0]?.width || 1, state.images[0]?.height || 1);
            gl.uniform2f(this.uniforms.imgOffsetA, state.images[0]?.offsetX || 0, state.images[0]?.offsetY || 0);
            gl.uniform2f(this.uniforms.imgScaleA, state.images[0]?.scaleX || 1, state.images[0]?.scaleY || 1);
        } else {
            gl.uniform1i(this.uniforms.hasA, 0);
        }

        if (this.textures[1]) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
            gl.uniform1i(this.uniforms.imageB, 1);
            gl.uniform1i(this.uniforms.hasB, 1);
            gl.uniform2f(this.uniforms.resB, state.images[1]?.width || 1, state.images[1]?.height || 1);
            gl.uniform2f(this.uniforms.imgOffsetB, state.images[1]?.offsetX || 0, state.images[1]?.offsetY || 0);
            gl.uniform2f(this.uniforms.imgScaleB, state.images[1]?.scaleX || 1, state.images[1]?.scaleY || 1);

        } else {
            gl.uniform1i(this.uniforms.hasB, 0);
        }

        gl.uniform2f(this.uniforms.offset, state.transform.offsetX, state.transform.offsetY);
        gl.uniform1f(this.uniforms.scale, state.transform.scale);
        gl.uniform2f(this.uniforms.canvasRes, this.canvas.width, this.canvas.height);

        let modeInt = 0;
        if (state.mode === 'wipe') modeInt = 0;
        else if (state.mode === 'ab') modeInt = 1;
        else if (state.mode === 'diff') modeInt = 2;
        else if (state.mode === 'mask') modeInt = 3;

        gl.uniform1i(this.uniforms.mode, modeInt);
        gl.uniform1f(this.uniforms.wipePos, state.wipe.position);
        gl.uniform1i(this.uniforms.wipeDir, state.wipe.direction === 'horizontal' ? 0 : 1);
        gl.uniform1f(this.uniforms.diffMult, state.diff.mult);

        gl.uniform1i(this.uniforms.maskType, state.mask.type === 'checker' ? 0 : 1);
        gl.uniform1f(this.uniforms.maskSize, state.mask.size);
        gl.uniform1f(this.uniforms.maskVal, state.mask.valueMult);

        gl.uniform1i(this.uniforms.toggleState, state.isHoldingB ? 1 : 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
