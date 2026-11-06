// WebGL2 fast path for very large vaults. Draws every edge as a GL line and
// every node as a soft point sprite in two draw calls, instead of thousands of
// Canvas 2D path operations. Labels, particles and overlays stay on the 2D
// canvas above it. index.html uses this when `renderer` is 'webgl', or when it
// is 'auto' and the vault is in the massive/ultra tier.
(function () {
  'use strict';

  const POINT_VS = `#version 300 es
  in vec2 a_pos; in float a_size; in vec4 a_color;
  uniform vec2 u_res; uniform float u_dpr;
  out vec4 v_color;
  void main() {
    vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    gl_PointSize = a_size * u_dpr;
    v_color = a_color;
  }`;
  const POINT_FS = `#version 300 es
  precision mediump float;
  in vec4 v_color; uniform float u_glow; out vec4 outColor;
  void main() {
    float d = length(gl_PointCoord * 2.0 - 1.0);
    if (d > 1.0) discard;
    // Solid core out to ~0.35 of the sprite, then a soft glow falloff.
    float core = 1.0 - smoothstep(0.28, 0.38, d);
    float halo = (1.0 - d) * (1.0 - d) * u_glow;
    float a = max(core, halo) * v_color.a;
    outColor = vec4(v_color.rgb * a, a);
  }`;
  const LINE_VS = `#version 300 es
  in vec2 a_pos; in vec4 a_color;
  uniform vec2 u_res; out vec4 v_color;
  void main() {
    vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_color = a_color;
  }`;
  const LINE_FS = `#version 300 es
  precision mediump float;
  in vec4 v_color; out vec4 outColor;
  void main() { outColor = vec4(v_color.rgb * v_color.a, v_color.a); }`;

  function compile(gl, vs, fs) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
    return p;
  }

  function hexToUnit(hex, cache) {
    let c = cache.get(hex);
    if (c) return c;
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    cache.set(hex, c);
    return c;
  }

  // Off-screen parking spot for vertices whose node has no position yet; the
  // GPU clips them away.
  const FAR = -1e6;

  function create(canvas) {
    // No preserveDrawingBuffer: it costs an extra copy every frame. Callers
    // that read the canvas (export, cross-fade snapshot) call redraw() first,
    // in the same task, so the drawing buffer is valid when they read it.
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: false });
    if (!gl) return null;
    let pointProg, lineProg;
    try {
      pointProg = compile(gl, POINT_VS, POINT_FS);
      lineProg = compile(gl, LINE_VS, LINE_FS);
    } catch (e) {
      console.warn('webgl renderer unavailable:', e.message);
      return null;
    }
    const colorCache = new Map();
    const loc = {
      p: { pos: gl.getAttribLocation(pointProg, 'a_pos'), size: gl.getAttribLocation(pointProg, 'a_size'), color: gl.getAttribLocation(pointProg, 'a_color'),
        res: gl.getUniformLocation(pointProg, 'u_res'), dpr: gl.getUniformLocation(pointProg, 'u_dpr'), glow: gl.getUniformLocation(pointProg, 'u_glow') },
      l: { pos: gl.getAttribLocation(lineProg, 'a_pos'), color: gl.getAttribLocation(lineProg, 'a_color'), res: gl.getUniformLocation(lineProg, 'u_res') }
    };
    // Positions change every frame while anything moves; colours and sizes
    // only when the graph or the settings change. They live in separate
    // buffers so a moving frame uploads 2 floats per vertex, not 6-7.
    const pointPosBuf = gl.createBuffer();
    const pointAttrBuf = gl.createBuffer();
    const linePosBuf = gl.createBuffer();
    const lineColorBuf = gl.createBuffer();
    const pointVao = gl.createVertexArray();
    gl.bindVertexArray(pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointPosBuf);
    gl.enableVertexAttribArray(loc.p.pos);
    gl.vertexAttribPointer(loc.p.pos, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointAttrBuf);
    gl.enableVertexAttribArray(loc.p.size);
    gl.vertexAttribPointer(loc.p.size, 1, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(loc.p.color);
    gl.vertexAttribPointer(loc.p.color, 4, gl.FLOAT, false, 20, 4);
    const lineVao = gl.createVertexArray();
    gl.bindVertexArray(lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, linePosBuf);
    gl.enableVertexAttribArray(loc.l.pos);
    gl.vertexAttribPointer(loc.l.pos, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineColorBuf);
    gl.enableVertexAttribArray(loc.l.color);
    gl.vertexAttribPointer(loc.l.color, 4, gl.FLOAT, false, 16, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    let pointPos = new Float32Array(0), pointAttr = new Float32Array(0);
    let linePos = new Float32Array(0), lineColor = new Float32Array(0);
    // GPU-side capacity (in floats) of each buffer: grown with bufferData,
    // otherwise refilled in place with bufferSubData.
    const cap = { pp: 0, pa: 0, lp: 0, lc: 0 };
    let nodeList = [], linkList = [];
    let nodeCount = 0, edgeCount = 0;
    let staticKey = null, posKey = null;
    let lastAdditive = null, lastGlow = null;
    let needsRender = true;
    let W = 1, H = 1, dpr = 1;

    function upload(buf, data, used, capKey) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      if (cap[capKey] < used) {
        cap[capKey] = data.length;
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      } else if (used > 0) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, used);
      }
    }

    function resize(w, h, ratio) {
      W = w; H = h; dpr = ratio;
      canvas.width = Math.max(1, Math.round(w * ratio));
      canvas.height = Math.max(1, Math.round(h * ratio));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      needsRender = true;
    }

    // Colours, sizes and the set of drawn nodes/edges. Rebuilt only when
    // opts.staticKey changes.
    function buildStatic(opts) {
      const nodes = opts.nodes, links = opts.links;
      const include = opts.include;
      nodeList = [];
      for (let i = 0; i < nodes.length; i++) if (include(nodes[i])) nodeList.push(nodes[i]);
      linkList = [];
      const step = Math.max(1, opts.linkStep || 1);
      for (let i = 0; i < links.length; i += step) {
        const l = links[i];
        if (include(l.source) && include(l.target)) linkList.push(l);
      }
      nodeCount = nodeList.length;
      edgeCount = linkList.length;
      if (pointPos.length < nodeCount * 2) { pointPos = new Float32Array(nodeCount * 2); pointAttr = new Float32Array(nodeCount * 5); }
      if (linePos.length < edgeCount * 4) { linePos = new Float32Array(edgeCount * 4); lineColor = new Float32Array(edgeCount * 8); }
      for (let i = 0; i < nodeCount; i++) {
        const n = nodeList[i];
        const c = hexToUnit(opts.colorOf(n), colorCache);
        const o = i * 5;
        pointAttr[o] = opts.nodeSize(n);
        pointAttr[o + 1] = c[0]; pointAttr[o + 2] = c[1]; pointAttr[o + 3] = c[2]; pointAttr[o + 4] = opts.nodeAlpha(n);
      }
      const al = opts.edgeAlpha;
      for (let i = 0; i < edgeCount; i++) {
        const c = hexToUnit(opts.edgeColorOf(linkList[i]), colorCache);
        const o = i * 8;
        lineColor[o] = lineColor[o + 4] = c[0];
        lineColor[o + 1] = lineColor[o + 5] = c[1];
        lineColor[o + 2] = lineColor[o + 6] = c[2];
        lineColor[o + 3] = lineColor[o + 7] = al;
      }
      upload(pointAttrBuf, pointAttr, nodeCount * 5, 'pa');
      upload(lineColorBuf, lineColor, edgeCount * 8, 'lc');
      if (colorCache.size > 1024) colorCache.clear();
    }

    function writePositions() {
      for (let i = 0; i < nodeCount; i++) {
        const n = nodeList[i];
        const x = n.__fx, y = n.__fy;
        const ok = x === x && y === y; // neither is NaN
        pointPos[i * 2] = ok ? x : FAR; pointPos[i * 2 + 1] = ok ? y : FAR;
      }
      for (let i = 0; i < edgeCount; i++) {
        const l = linkList[i];
        const a = l.source, b = l.target;
        const o = i * 4;
        if (a.__fx === a.__fx && a.__fy === a.__fy && b.__fx === b.__fx && b.__fy === b.__fy) {
          linePos[o] = a.__fx; linePos[o + 1] = a.__fy; linePos[o + 2] = b.__fx; linePos[o + 3] = b.__fy;
        } else {
          linePos[o] = linePos[o + 1] = linePos[o + 2] = linePos[o + 3] = FAR;
        }
      }
      upload(pointPosBuf, pointPos, nodeCount * 2, 'pp');
      upload(linePosBuf, linePos, edgeCount * 4, 'lp');
    }

    function render(additive, glow) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      if (additive) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (edgeCount > 0) {
        gl.useProgram(lineProg);
        gl.uniform2f(loc.l.res, W, H);
        gl.bindVertexArray(lineVao);
        gl.drawArrays(gl.LINES, 0, edgeCount * 2);
      }
      if (nodeCount > 0) {
        gl.useProgram(pointProg);
        gl.uniform2f(loc.p.res, W, H);
        gl.uniform1f(loc.p.dpr, dpr);
        gl.uniform1f(loc.p.glow, glow);
        gl.bindVertexArray(pointVao);
        gl.drawArrays(gl.POINTS, 0, nodeCount);
      }
      gl.bindVertexArray(null);
      lastAdditive = additive; lastGlow = glow;
      needsRender = false;
    }

    // opts: { nodes, links, linkStep, include(node), colorOf(node),
    //         edgeColorOf(link), nodeAlpha(node), nodeSize(node), edgeAlpha,
    //         additive, glow, staticKey, posKey }
    // staticKey changes whenever colours, sizes or the drawn set may change;
    // posKey whenever any position may have moved ('' means "every frame").
    // When neither changed nothing is rebuilt, uploaded or drawn: the canvas
    // keeps showing the last frame. Returns the number of nodes drawn.
    function draw(opts) {
      if (!opts.staticKey || opts.staticKey !== staticKey) {
        staticKey = opts.staticKey;
        buildStatic(opts);
        posKey = null;
        needsRender = true;
      }
      if (!opts.posKey || opts.posKey !== posKey) {
        posKey = opts.posKey;
        writePositions();
        needsRender = true;
      }
      if (needsRender || opts.additive !== lastAdditive || opts.glow !== lastGlow) render(opts.additive, opts.glow);
      return nodeCount;
    }

    // Re-issues the last frame from the uploaded buffers (no CPU rebuild), so
    // a caller can read the canvas in the same task.
    function redraw() {
      if (lastAdditive === null) return;
      render(lastAdditive, lastGlow);
    }

    function clear() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      staticKey = null; posKey = null; needsRender = true;
    }

    return { resize, draw, redraw, clear, canvas };
  }

  window.GLRenderer = { create };
})();
