/**
 * Aufgabe 7 – Tiefen-Buffer (Z-Buffer) als Graustufen
 *
 * Eine einfache Straßenschlucht aus Häusern, Brücken, Rohren, Wassertanks und Autos reicht weit in die Tiefe.
 * Der Fragment-Shader liest den Tiefenwert über gl_FragCoord.z und gibt ihn als Grauwert aus:
 *   roh:     grau = gl_FragCoord.z                         (nichtlinear, fast alles hell)
 *   linear:  grau = (d − n) / (f − n), d aus z zurückgerechnet  (gleichmäßiger Verlauf)
 * Nahe Fragmente → kleiner z-Wert → dunkel.
 */
(() => {
  "use strict";

  // Vektoren und Matrizen
  const PI = Math.PI, TAU = 2 * PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  const M4 = {
    identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b) {
      const o = new Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    translate: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
    scale: (x, y = x, z = x) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
    rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
    rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
    rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    chain: (...ms) => ms.reduce((a, b) => M4.mul(a, b)),
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    },
    normalMatrix(m) {
      const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
      const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
      const det = a * A + b * B + c * C || 1;
      return [A / det, B / det, C / det,
        -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det,
        (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
    },
  };

  // Farben
  const P = {
    magenta: hex("#c738a1"), tuerkis: hex("#2a93c0"), orange: hex("#ef7f2e"), rot: hex("#dc3845"),
    gruen: hex("#98ce3b"), blau: hex("#4e86d0"), gelb: hex("#e8bf55"), violett: hex("#7b5cc4"),
    stein: hex("#c9c2b4"), steinDunkel: hex("#8f877a"), boden: hex("#6f7a86"),
  };

  // Mesh-Baukasten
  function Mesh() { return { pos: [], nor: [], col: [], idx: [] }; }
  function vert(m, p, n, c) { m.pos.push(...p); m.nor.push(...n); m.col.push(...c); return m.pos.length / 3 - 1; }

  /** Quader (Grundkörper) */
  function box(w, h, d, colorFn) {
    const m = Mesh(), x = w / 2, y = h / 2, z = d / 2;
    [
      [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
      [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
      [[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]],
      [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]],
      [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]],
      [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]],
    ].forEach(([n, q]) => {
      const i = q.map((p) => vert(m, p, n, colorFn(p, n)));
      m.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
    });
    return m;
  }

  /** Zylinder bzw. Kegel (r1 = 0) entlang y von 0 bis h, mit Deckeln */
  function cylinder(r0, r1, h, n, colorFn) {
    const m = Mesh(), slope = (r0 - r1) / h;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU, c = Math.cos(a), s = Math.sin(a), nn = norm([c, slope, s]);
      vert(m, [r0 * c, 0, r0 * s], nn, colorFn(0, k / n));
      vert(m, [r1 * c, h, r1 * s], nn, colorFn(1, k / n));
    }
    for (let k = 0; k < n; k++) { const i = 2 * k; m.idx.push(i, i + 1, i + 3, i, i + 3, i + 2); }
    for (const [y, r, ny] of [[0, r0, -1], [h, r1, 1]]) {
      if (r <= 0) continue;
      const c0 = vert(m, [0, y, 0], [0, ny, 0], colorFn(y / h, 0.5)), first = m.pos.length / 3;
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU; vert(m, [r * Math.cos(a), y, r * Math.sin(a)], [0, ny, 0], colorFn(y / h, k / n)); }
      for (let k = 0; k < n; k++) m.idx.push(c0, first + k, first + (k + 1) % n);
    }
    return m;
  }

  /** Parametrisierte Fläche (hier für den Torus) */
  function surface(f, nU, nV, colorFn) {
    const m = Mesh(), eps = 1e-4;
    const normal = (s, t) => norm(cross(sub(f(s + eps, t), f(s - eps, t)), sub(f(s, t + eps), f(s, t - eps))));
    for (let i = 0; i <= nU; i++) for (let j = 0; j <= nV; j++) { const s = i / nU, t = j / nV; vert(m, f(s, t), normal(s, t), colorFn(s, t)); }
    for (let i = 0; i < nU; i++) for (let j = 0; j < nV; j++) {
      const a = i * (nV + 1) + j, b = a + nV + 1;
      m.idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
    return m;
  }
  const torus = (R, r, colorFn) => surface((s, t) => {
    const u = s * TAU, v = t * TAU;
    return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];   // liegt in der XY-Ebene
  }, 64, 24, colorFn);

  /** Rekursive Kugel aus einem Oktaeder (wie Aufgabe 5), glatte Normalen */
  function sphere(depth, colorFn) {
    const V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    let F = [[2, 4, 0], [2, 0, 5], [2, 5, 1], [2, 1, 4], [3, 0, 4], [3, 5, 0], [3, 1, 5], [3, 4, 1]];
    const cache = new Map();
    const mid = (i, j) => {
      const k = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (!cache.has(k)) { V.push(norm(scale(add(V[i], V[j]), 0.5))); cache.set(k, V.length - 1); }
      return cache.get(k);
    };
    for (let l = 0; l < depth; l++) {
      F = F.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]; });
    }
    const m = Mesh();
    V.forEach((p) => vert(m, p, p, colorFn(p)));
    m.idx = F.flat();
    return m;
  }

  // Szene
  const T = M4.translate, S = M4.scale;
  const PIVOT = [0, 2, -18];                 // Drehpunkt der Szene
  const CAM_Z = 8;                           // Kamera blickt entlang −Z
  const GROUND = -1.5;                       // Oberkante der Straße

  function buildScene() {
    const objs = [];
    const addObj = (name, kind, mesh, model) => objs.push({ name, kind, mesh, model });
    // Flächen nach oben etwas heller, Dach dunkler – damit die Kanten in der Farbansicht sichtbar sind
    const shade = (c) => (p, n) => (n[1] > 0.5 ? mix(c, [0.2, 0.2, 0.22], 0.45) : mix(c, [0, 0, 0], 0.12 * Math.abs(n[0])));

    // Straße und Gehwege
    addObj("Fahrbahn", "Quader", box(7, 0.2, 74, () => [0.3, 0.32, 0.36]), T(0, GROUND - 0.1, -25));
    [-1, 1].forEach((sgn, k) => addObj(`Gehweg ${k + 1}`, "Quader", box(1.6, 0.36, 74, shade([0.68, 0.68, 0.66])), T(sgn * 4.3, GROUND - 0.03, -25)));
    for (let k = 0; k < 18; k++) addObj(`Fahrbahnmarkierung ${k + 1}`, "Quader", box(0.14, 0.04, 1.6, () => [0.95, 0.95, 0.9]), T(0, GROUND, 4 - k * 3.6));

    // Häuser: sechs Blöcke je Straßenseite (Quader), dazwischen Querstraßen
    const BLOCKS = [[3, -5], [-6, -14], [-17, -25], [-26, -34], [-37, -45], [-46, -54]];
    const H = [[6, 9], [10, 5], [5, 11], [12, 7], [8, 13], [14, 9]];
    const COLORS = [[0.82, 0.72, 0.56], [0.7, 0.4, 0.32], [0.6, 0.64, 0.68], [0.86, 0.84, 0.78], mix(P.tuerkis, [0.65, 0.65, 0.65], 0.5), mix(P.gelb, [0.6, 0.6, 0.6], 0.35)];
    const top = (k, side) => GROUND + H[k][side];
    const zc = (k) => (BLOCKS[k][0] + BLOCKS[k][1]) / 2;
    BLOCKS.forEach(([z0, z1], k) => [-1, 1].forEach((sgn, side) => {
      const h = H[k][side];
      addObj(`Haus ${side ? "rechts" : "links"} ${k + 1}`, "Quader", box(6, h, z0 - z1, shade(COLORS[(k + 3 * side) % COLORS.length])), T(sgn * 8, GROUND + h / 2, zc(k)));
    }));

    // Turm am Ende der Straße mit Pyramidendach (Kegel mit vier Seiten, steckt im Turm)
    addObj("Turm", "Quader", box(10, 26, 6, shade([0.5, 0.56, 0.66])), T(0, GROUND + 13, -60));
    addObj("Pyramidendach", "Kegel", cylinder(6, 0, 5, 4, (y) => mix([0.35, 0.38, 0.45], [0.75, 0.78, 0.85], y)), M4.chain(T(0, GROUND + 25, -60), M4.rotY(PI / 4)));

    // Zwei Brücken (Quader) und zwei Rohre (Zylinder) quer über die Straße – sie stecken in beiden Häusern
    addObj("Brücke 1", "Quader", box(12, 0.9, 2, shade([0.5, 0.6, 0.7])), T(0, GROUND + 3, zc(1)));
    addObj("Brücke 2", "Quader", box(12, 0.9, 2, shade([0.5, 0.6, 0.7])), T(0, GROUND + 5, zc(3)));
    [[0, 4.4], [4, 2.6]].forEach(([k, y], i) => addObj(`Rohr ${i + 1}`, "Zylinder", cylinder(0.3, 0.3, 14, 28, (t) => mix(P.orange, P.rot, t)), M4.chain(T(-7, GROUND + y, zc(k)), M4.rotZ(-PI / 2))));

    // Drei Wassertanks (Kugeln), halb im Dach versunken
    [[0, 0], [2, 1], [4, 1]].forEach(([k, side], i) => addObj(`Wassertank ${i + 1}`, "Kugel",
      sphere(3, (p) => mix([0.55, 0.42, 0.32], [0.85, 0.75, 0.6], 0.5 + 0.5 * p[1])), M4.chain(T((side ? 1 : -1) * 8, top(k, side), zc(k)), S(1.3))));

    // Drei Autos: Karosserie und Kabine (Quader) überlappen
    [[-1.7, -3, P.rot], [1.7, -16, P.tuerkis], [-1.7, -30, P.gelb]].forEach(([x, z, c], k) => {
      addObj(`Karosserie ${k + 1}`, "Quader", box(1.7, 0.7, 3.8, (p, n) => mix(c, [1, 1, 1], 0.12 * n[1])), T(x, GROUND + 0.45, z));
      addObj(`Kabine ${k + 1}`, "Quader", box(1.45, 0.65, 2.0, (p, n) => (n[1] > 0.5 ? c : [0.22, 0.28, 0.36])), T(x, GROUND + 1.05, z + 0.2));
    });
    return objs;
  }

  // WebGL
  const $ = (id) => document.getElementById(id);
  const canvas = $("gl");
  const status = $("status");
  const setStatus = (t, err = false) => { status.textContent = t; status.classList.toggle("is-error", err); };

  const VS = `
    attribute vec3 aPos;
    attribute vec3 aNormal;
    attribute vec3 aColor;
    uniform mat4 uModel, uView, uProj;
    uniform mat3 uNormalMat;
    varying vec3 vColor;
    varying vec3 vNormal;
    void main() {
      gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
      vNormal = uNormalMat * aNormal;
      vColor = aColor;
    }`;
  const FS = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;              // z-Werte nahe 1 brauchen volle Genauigkeit
    #else
      precision mediump float;
    #endif
    varying vec3 vColor;
    varying vec3 vNormal;
    uniform int uMode;                    // 0 = Farbe, 1 = Tiefe roh, 2 = Tiefe linear
    uniform float uNear, uFar;
    void main() {
      float z = gl_FragCoord.z;           // Tiefenwert des Fragments im Fenster: 0 = Near, 1 = Far
      if (uMode == 1) {
        gl_FragColor = vec4(vec3(z), 1.0);
      } else if (uMode == 2) {
        float ndc = z * 2.0 - 1.0;                                            // zurück nach [-1, 1]
        float d = 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); // Abstand zur Kamera
        gl_FragColor = vec4(vec3((d - uNear) / (uFar - uNear)), 1.0);
      } else {
        vec3 L = normalize(vec3(0.4, 0.8, 0.45));
        float diff = abs(dot(normalize(vNormal), L));
        gl_FragColor = vec4(vColor * (0.38 + 0.62 * diff), 1.0);
      }
    }`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader-Fehler: ${gl.getShaderInfoLog(sh)}`);
    return sh;
  }

  let gl, loc, scene = [];

  function upload(mesh) {
    const mk = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    if (mesh.pos.length / 3 > 65535) throw new Error("Zu viele Vertices für UNSIGNED_SHORT");
    return {
      pos: mk(gl.ARRAY_BUFFER, new Float32Array(mesh.pos)),
      nor: mk(gl.ARRAY_BUFFER, new Float32Array(mesh.nor)),
      col: mk(gl.ARRAY_BUFFER, new Float32Array(mesh.col)),
      idx: mk(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.idx)), nIdx: mesh.idx.length,
    };
  }

  function init() {
    gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error("Ihr Browser unterstützt kein WebGL. Bitte aktivieren Sie die Hardwarebeschleunigung.");
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Programm-Fehler: ${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);
    loc = {};
    ["aPos", "aNormal", "aColor"].forEach((n) => (loc[n] = gl.getAttribLocation(prog, n)));
    ["uModel", "uView", "uProj", "uNormalMat", "uMode", "uNear", "uFar"].forEach((n) => (loc[n] = gl.getUniformLocation(prog, n)));
    gl.enable(gl.DEPTH_TEST);              // ← der Z-Buffer-Algorithmus der Hardware
    gl.depthFunc(gl.LESS);
    gl.clearDepth(1.0);
    scene = buildScene().map((o) => ({ ...o, gpu: upload(o.mesh), triangles: o.mesh.idx.length / 3 }));
  }

  // Zustand
  const VIEW0 = { x: 0, y: 1.2, yaw: 0, pitch: 0 };
  const view = { ...VIEW0 };
  const LIMITS = { x: [-3, 3], y: [-1, 20] };
  const clip = { near: 1, far: 70 };
  let mode = "linear";
  const MODES = ["farbe", "roh", "linear", "geteilt"];
  const MODE_LABEL = { farbe: "Farbe", roh: "Z-Buffer roh", linear: "Z-Buffer linear", geteilt: "Geteilt: links Farbe, rechts Z-Buffer linear" };
  const MODE_ID = { farbe: 0, roh: 1, linear: 2 };
  let pointer = null;                        // Mausposition für die Grauwert-Anzeige

  /** Szene um den Drehpunkt drehen: T(p) · Rx · Ry · T(−p) */
  const sceneRotation = () => M4.chain(T(...PIVOT), M4.rotX(view.pitch), M4.rotY(view.yaw), T(...PIVOT.map((v) => -v)));
  /** Kamera verschiebt sich nur in der XY-Ebene, Blick entlang −Z: View = T(−x, −y, −z) */
  const viewMatrix = () => T(-view.x, -view.y, -CAM_Z);

  // Tiefenwert (Fensterkoordinate) zu Abstand und zurück
  const zWindow = (d, n = clip.near, f = clip.far) => 0.5 * ((f + n) / (f - n) - (2 * f * n) / ((f - n) * d)) + 0.5;
  const distFromZ = (z, n = clip.near, f = clip.far) => (2 * n * f) / (f + n - (2 * z - 1) * (f - n));

  // Zeichnen
  function bind(o) {
    [["aPos", o.pos], ["aNormal", o.nor], ["aColor", o.col]].forEach(([n, b]) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc[n]); gl.vertexAttribPointer(loc[n], 3, gl.FLOAT, false, 0, 0);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.idx);
  }

  function drawScene(modeId, rot) {
    gl.uniform1i(loc.uMode, modeId);
    if (modeId === 0) gl.clearColor(0, 0, 0, 0);       // Farbe: Himmel aus dem CSS-Hintergrund
    else gl.clearColor(1, 1, 1, 1);                     // Tiefe: leerer Bereich = Far = weiß
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    scene.forEach((o) => {
      const m = M4.mul(rot, o.model);
      gl.uniformMatrix4fv(loc.uModel, false, new Float32Array(m));
      gl.uniformMatrix3fv(loc.uNormalMat, false, new Float32Array(M4.normalMatrix(m)));
      bind(o.gpu);
      gl.drawElements(gl.TRIANGLES, o.gpu.nIdx, gl.UNSIGNED_SHORT, 0);
    });
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniformMatrix4fv(loc.uProj, false, new Float32Array(M4.perspective(PI / 4, w / h, clip.near, clip.far)));
    gl.uniformMatrix4fv(loc.uView, false, new Float32Array(viewMatrix()));
    gl.uniform1f(loc.uNear, clip.near);
    gl.uniform1f(loc.uFar, clip.far);
    const rot = sceneRotation();

    if (mode === "geteilt") {
      drawScene(0, rot);
      gl.enable(gl.SCISSOR_TEST);                         // rechte Hälfte neu: Tiefe linear
      gl.scissor(Math.floor(w / 2), 0, w - Math.floor(w / 2), h);
      drawScene(2, rot);
      gl.disable(gl.SCISSOR_TEST);
    } else drawScene(MODE_ID[mode], rot);

    readPointer(w, h, dpr);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) console.error(`WebGL-Fehler 0x${err.toString(16)}`);
    renderReadout();
  }

  // Anzeige
  const f = (v, d = 2) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
  const degOf = (r) => `${f((((r * 180) / PI) % 360 + 360) % 360, 0)}°`;
  const degSigned = (r) => `${f((r * 180) / PI, 0)}°`;

  /** Grauwert unter dem Mauszeiger auslesen und in einen Abstand zurückrechnen */
  function readPointer(w, h, dpr) {
    const out = $("px-value");
    if (!pointer) { out.textContent = "Maus über die Szene bewegen"; return; }
    const px = Math.round(pointer.x * dpr), py = Math.round(h - pointer.y * dpr);
    if (px < 0 || py < 0 || px >= w || py >= h) { out.textContent = "–"; return; }
    let m = mode;
    if (m === "geteilt") m = px >= w / 2 ? "linear" : "farbe";
    if (m === "farbe") { out.textContent = "nur in den Tiefenansichten"; return; }
    const buf = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const g = buf[0] / 255;
    if (g >= 1) { out.textContent = `${f(g, 3)} – leer (Far-Ebene)`; return; }
    const d = m === "roh" ? distFromZ(g) : clip.near + g * (clip.far - clip.near);
    out.textContent = `${buf[0]}/255 = ${f(g, 3)} → Abstand ≈ ${f(d, 1)}${m === "roh" ? " (grob: nur 256 Stufen)" : ""}`;
  }

  function renderReadout() {
    $("ro-cam").textContent = `(${f(view.x)} | ${f(view.y)} | ${f(CAM_Z)})`;
    $("ro-yaw").textContent = degOf(view.yaw);
    $("ro-pitch").textContent = degSigned(view.pitch);
  }

  /** Alles, was von Near/Far abhängt: Werte, Diagramm, Tabelle, Textalternative */
  function renderClip() {
    const n = clip.near, fa = clip.far;
    $("near-out").textContent = f(n, 1);
    $("far-out").textContent = f(fa, 0);
    $("ro-half").textContent = f(distFromZ(0.5), 2);
    $("ro-90").textContent = f(distFromZ(0.9), 2);
    $("ro-share").textContent = `${f((100 * (distFromZ(0.5) - n)) / (fa - n), 1)} %`;

    // Diagramm: Grauwert über dem Abstand d ∈ [n, f]
    const W = 640, H = 300, L = 54, R = 16, Tp = 16, B = 46;
    const X = (d) => L + ((d - n) / (fa - n)) * (W - L - R), Y = (g) => Tp + (1 - g) * (H - Tp - B);
    const raw = [], lin = [];
    for (let k = 0; k <= 240; k++) {
      const d = n + (fa - n) * Math.pow(k / 240, 2.2);   // vorn dichter abtasten (dort ist die Kurve steil)
      raw.push(`${X(d).toFixed(1)},${Y(zWindow(d)).toFixed(1)}`);
      lin.push(`${X(d).toFixed(1)},${Y((d - n) / (fa - n)).toFixed(1)}`);
    }
    $("c-raw").setAttribute("points", raw.join(" "));
    $("c-lin").setAttribute("points", lin.join(" "));
    const xh = X(distFromZ(0.5));
    ["x1", "x2"].forEach((a) => $("c-half").setAttribute(a, xh.toFixed(1)));
    const ticks = $("c-ticks");
    ticks.textContent = "";
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs, txt) => { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); if (txt) e.textContent = txt; ticks.appendChild(e); };
    for (let i = 0; i <= 5; i++) {
      const d = n + ((fa - n) * i) / 5;
      mk("line", { class: "gridl", x1: X(d), x2: X(d), y1: Tp, y2: H - B });
      mk("text", { x: X(d), y: H - B + 18, "text-anchor": "middle" }, f(d, d < 10 ? 1 : 0));
    }
    for (let i = 0; i <= 4; i++) {
      const g = i / 4;
      mk("line", { class: "gridl", x1: L, x2: W - R, y1: Y(g), y2: Y(g) });
      mk("text", { x: L - 8, y: Y(g) + 4, "text-anchor": "end" }, f(g, 2));
    }
    $("chart").setAttribute("aria-label",
      `Diagramm: Grauwert über dem Abstand von ${f(n, 1)} bis ${f(fa, 0)}. Die rohe Kurve steigt sofort steil an und erreicht 0,5 schon bei ${f(distFromZ(0.5), 2)}; die lineare Kurve ist eine Gerade.`);

    // Tabelle mit Beispielabständen
    const tbody = $("depth-body");
    tbody.textContent = "";
    [n, 2, 3, 5, 10, 20, 30, 40, 50, 60, fa].filter((d, i, a) => d >= n && d <= fa && a.indexOf(d) === i).sort((a, b) => a - b).forEach((d) => {
      const zr = Math.max(0, zWindow(d)), zl = (d - n) / (fa - n), sw = (g) => `<span class="grayswatch" style="background:rgb(${Math.round(g * 255)},${Math.round(g * 255)},${Math.round(g * 255)})"></span>`;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="num">${f(d, d < 10 ? 1 : 0)}</td><td class="num">${sw(zr)}${f(zr, 4)}</td><td class="num">${Math.round(zr * 255)}</td><td class="num">${sw(zl)}${f(zl, 4)}</td><td class="num">${Math.round(zl * 255)}</td>`;
      tbody.appendChild(tr);
    });
    renderDesc();
  }

  function renderDesc() {
    $("canvas-desc").textContent =
      `Straßenschlucht: Eine Straße mit drei Autos führt zwischen zwei Häuserreihen weit in die Tiefe, am Ende steht ein Turm mit Pyramidendach. ` +
      `Zwei Brücken und zwei Rohre führen quer über die Straße in die Häuser, drei Wassertanks stecken halb in den Dächern. ` +
      `Ansicht: ${MODE_LABEL[mode]}. ${mode === "farbe" ? "" : "Nahe Flächen sind dunkel, ferne hell, leerer Raum ist weiß. "}` +
      `Near ${f(clip.near, 1)}, Far ${f(clip.far, 0)}.`;
  }

  // Bedienung
  let frame = null;
  const redraw = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = null; draw(); }); };

  function move(dx, dy) {
    view.x = clamp(view.x + dx, ...LIMITS.x);
    view.y = clamp(view.y + dy, ...LIMITS.y);
    redraw();
  }
  function rotate(dyaw, dpitch) {
    view.yaw += dyaw;
    view.pitch = clamp(view.pitch + dpitch, -PI / 12, (5 * PI) / 12);   // −15° … 75°
    redraw();
  }
  function reset() { Object.assign(view, VIEW0); redraw(); setStatus("Kamera und Drehung zurückgesetzt."); }
  function setMode(m, announce = true) {
    mode = m;
    document.querySelectorAll("[data-mode]").forEach((b) => { const on = b.dataset.mode === m; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
    const split = m === "geteilt";
    ["split-l", "split-r", "split-line"].forEach((id) => ($(id).hidden = !split));
    renderDesc(); redraw();
    if (announce) setStatus(`Ansicht: ${MODE_LABEL[m]}.`);
  }
  function setClip(which, value, announce) {
    clip[which] = value;
    if (clip.far - clip.near < 5) {                      // Near muss deutlich vor Far liegen
      if (which === "near") clip.near = clip.far - 5; else clip.far = clip.near + 5;
    }
    $("near").value = clip.near; $("far").value = clip.far;
    renderClip(); redraw();
    if (announce) setStatus(`Near ${f(clip.near, 1)}, Far ${f(clip.far, 0)}.`);
  }

  const STEP = 0.25, ROT = (5 * PI) / 180;
  $("btn-w").addEventListener("click", () => move(0, STEP * 2));
  $("btn-s").addEventListener("click", () => move(0, -STEP * 2));
  $("btn-a").addEventListener("click", () => move(-STEP * 2, 0));
  $("btn-d").addEventListener("click", () => move(STEP * 2, 0));
  $("btn-rl").addEventListener("click", () => rotate(-ROT * 2, 0));
  $("btn-rr").addEventListener("click", () => rotate(ROT * 2, 0));
  $("btn-ru").addEventListener("click", () => rotate(0, ROT * 2));
  $("btn-rd").addEventListener("click", () => rotate(0, -ROT * 2));
  $("btn-reset").addEventListener("click", reset);
  $("btn-clip").addEventListener("click", () => { setClip("near", 1); setClip("far", 70); setStatus("Near 1, Far 70 wiederhergestellt."); });
  $("near").addEventListener("input", (e) => setClip("near", Number(e.target.value), false));
  $("far").addEventListener("input", (e) => setClip("far", Number(e.target.value), false));
  ["near", "far"].forEach((id) => $(id).addEventListener("change", () => setStatus(`Near ${f(clip.near, 1)}, Far ${f(clip.far, 0)}.`)));
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("mode-group").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = MODES[(MODES.indexOf(mode) + d + MODES.length) % MODES.length];
    setMode(next); document.querySelector(`[data-mode="${next}"]`).focus();
  });

  // Maus: ziehen dreht die Szene; Bewegung ohne Taste liest den Grauwert aus
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (drag) { rotate((e.clientX - drag.x) * 0.008, (e.clientY - drag.y) * 0.008); drag = { x: e.clientX, y: e.clientY }; }
    else redraw();
  });
  canvas.addEventListener("pointerleave", () => { pointer = null; redraw(); });
  ["pointerup", "pointercancel"].forEach((t) => canvas.addEventListener(t, () => (drag = null)));

  // Tastatur
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privater Modus */ } },
  };
  const shortcuts = $("toggle-shortcuts");
  shortcuts.checked = store.get("shortcuts") !== "off";
  shortcuts.addEventListener("change", () => {
    store.set("shortcuts", shortcuts.checked ? "on" : "off");
    setStatus(shortcuts.checked ? "Tastenkürzel eingeschaltet." : "Tastenkürzel ausgeschaltet – Bedienung über die Schaltflächen.");
  });

  document.addEventListener("keydown", (e) => {
    if (!shortcuts.checked || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.closest && t.closest("input, textarea, select, [role=radiogroup]")) return;
    const k = e.key, fast = e.shiftKey ? 4 : 1;
    // Pfeiltasten nur in der Szene (sonst scrollen sie wie gewohnt die Seite)
    if (k.startsWith("Arrow") && t.closest && (t.closest("#buehne") || t === document.body)) {
      e.preventDefault();
      if (k === "ArrowLeft") rotate(-ROT * fast, 0);
      if (k === "ArrowRight") rotate(ROT * fast, 0);
      if (k === "ArrowUp") rotate(0, ROT * fast);
      if (k === "ArrowDown") rotate(0, -ROT * fast);
      return;
    }
    switch (k.toLowerCase()) {
      case "w": e.preventDefault(); move(0, STEP * fast); break;
      case "s": e.preventDefault(); move(0, -STEP * fast); break;
      case "a": e.preventDefault(); move(-STEP * fast, 0); break;
      case "d": e.preventDefault(); move(STEP * fast, 0); break;
      case "r": if (!e.repeat) { e.preventDefault(); reset(); } break;
      case "m": if (!e.repeat) { e.preventDefault(); setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); } break;
      case "1": case "2": case "3": case "4": if (!e.repeat) { e.preventDefault(); setMode(MODES[Number(k) - 1]); } break;
    }
  });

  // Design hell / dunkel
  const themeSwitch = $("theme-switch");
  function applyTheme(th) {
    document.documentElement.setAttribute("data-theme", th);
    themeSwitch.setAttribute("aria-checked", String(th === "dark"));
    if (gl) redraw();
  }
  themeSwitch.addEventListener("click", () => {
    const next = themeSwitch.getAttribute("aria-checked") === "true" ? "light" : "dark";
    applyTheme(next); store.set("theme", next);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => { if (!store.get("theme")) applyTheme(e.matches ? "dark" : "light"); });

  // Start
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  try {
    init();
    const tbody = $("scene-body"), groups = new Map();
    scene.forEach((o) => {
      const key = o.name.replace(/ (links|rechts)? ?\d+$/, "");
      const g = groups.get(key) || { name: key, kind: o.kind, count: 0, tris: 0 };
      g.count++; g.tris += o.triangles; groups.set(key, g);
    });
    groups.forEach((g) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${g.name}</td><td>${g.kind}</td><td class="num">${g.count}</td><td class="num">${g.tris.toLocaleString("de-DE")}</td>`;
      tbody.appendChild(tr);
    });
    $("scene-total").textContent = scene.reduce((s, o) => s + o.triangles, 0).toLocaleString("de-DE");
    $("scene-count").textContent = scene.length;
    setMode("linear", false);
    renderClip();
    draw();
    setStatus("");
    new ResizeObserver(() => redraw()).observe(canvas);
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setStatus("WebGL-Kontext verloren – bitte Seite neu laden.", true); });
    console.info(`Szene: ${scene.length} Objekte, ${$("scene-total").textContent} Dreiecke.`);
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  }
})();
