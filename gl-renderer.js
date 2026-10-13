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

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true });
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
    const pointBuf = gl.createBuffer();
    const lineBuf = gl.createBuffer();
    let pointData = new Float32Array(0);
    let lineData = new Float32Array(0);
    let W = 1, H = 1, dpr = 1;

    function resize(w, h, ratio) {
      W = w; H = h; dpr = ratio;
      canvas.width = Math.max(1, Math.round(w * ratio));
      canvas.height = Math.max(1, Math.round(h * ratio));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    // opts: { nodes, links, colorOf(node), edgeColorOf(link), nodeAlpha(node),
    //         nodeSize(node), edgeAlpha, additive, glow, visible(node) }
    function draw(opts) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      if (opts.additive) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // Edges: 2 vertices x (x, y, r, g, b, a)
      const links = opts.links;
      const step = Math.max(1, opts.linkStep || 1);
      const maxEdges = Math.ceil(links.length / step);
      if (lineData.length < maxEdges * 12) lineData = new Float32Array(maxEdges * 12);
      let e = 0;
      for (let i = 0; i < links.length; i += step) {
        const l = links[i];
        const a = l.source, b = l.target;
        if (!opts.visible(a) || !opts.visible(b)) continue;
        const c = hexToUnit(opts.edgeColorOf(l), colorCache);
        const al = opts.edgeAlpha;
        lineData.set([a.__fx, a.__fy, c[0], c[1], c[2], al, b.__fx, b.__fy, c[0], c[1], c[2], al], e * 12);
        e++;
      }
      if (e > 0) {
        gl.useProgram(lineProg);
        gl.uniform2f(loc.l.res, W, H);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, e * 12), gl.STREAM_DRAW);
        gl.enableVertexAttribArray(loc.l.pos);
        gl.vertexAttribPointer(loc.l.pos, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(loc.l.color);
        gl.vertexAttribPointer(loc.l.color, 4, gl.FLOAT, false, 24, 8);
        gl.drawArrays(gl.LINES, 0, e * 2);
      }

      // Nodes: x, y, size, r, g, b, a
      const nodes = opts.nodes;
      if (pointData.length < nodes.length * 7) pointData = new Float32Array(nodes.length * 7);
      let p = 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!opts.visible(n)) continue;
        const c = hexToUnit(opts.colorOf(n), colorCache);
        const o = p * 7;
        pointData[o] = n.__fx; pointData[o + 1] = n.__fy; pointData[o + 2] = opts.nodeSize(n);
        pointData[o + 3] = c[0]; pointData[o + 4] = c[1]; pointData[o + 5] = c[2]; pointData[o + 6] = opts.nodeAlpha(n);
        p++;
      }
      if (p > 0) {
        gl.useProgram(pointProg);
        gl.uniform2f(loc.p.res, W, H);
        gl.uniform1f(loc.p.dpr, dpr);
        gl.uniform1f(loc.p.glow, opts.glow);
        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, pointData.subarray(0, p * 7), gl.STREAM_DRAW);
        gl.enableVertexAttribArray(loc.p.pos);
        gl.vertexAttribPointer(loc.p.pos, 2, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(loc.p.size);
        gl.vertexAttribPointer(loc.p.size, 1, gl.FLOAT, false, 28, 8);
        gl.enableVertexAttribArray(loc.p.color);
        gl.vertexAttribPointer(loc.p.color, 4, gl.FLOAT, false, 28, 12);
        gl.drawArrays(gl.POINTS, 0, p);
      }
      return p;
    }

    function clear() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    return { resize, draw, clear, canvas };
  }

  window.GLRenderer = { create };
})();
