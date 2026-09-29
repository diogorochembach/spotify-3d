import {
	AdditiveBlending,
	Color,
	Mesh,
	PerspectiveCamera,
	PlaneGeometry,
	Points,
	Scene,
	ShaderMaterial,
	SphereGeometry,
	Vector3,
	WebGLRenderer,
} from 'three';

const DEFAULT_PALETTE = { top: '#ff6b3d', bottom: '#3366ff', accent: '#f4b45d' };
const DEFAULT_CONTROLS = {
	noiseSpeed: 2.35,
	// Slightly farther than the source reference so the complete ring and its
	// beat-driven prominences stay inside the compact player canvas.
	cameraDistance: 13.8,
	beatRadius: 2.67,
	beatFlare: 2.07,
	beatHeat: 1.51,
};
const MAX_PIXEL_RATIO = 1.5;
const TARGET_FRAME_INTERVAL = 1000 / 30;

const vertexShader = /* glsl */ `
	uniform float uTime;
	uniform float uLow;
	uniform float uMid;
	uniform float uHigh;
	uniform vec3 uBeatTarget;
	uniform float uBeatStrength;
	uniform float uBeatRadius;
	uniform float uBeatFlare;
	uniform float uBeatHeat;
	uniform vec3 uColorTop;
	uniform vec3 uColorBottom;
	uniform vec3 uAccent;
	varying float vAlpha;
	varying float vHeat;
	varying float vCrest;
	varying vec3 vColor;

	vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
	vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
	float snoise(vec3 v) {
		const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
		const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
		vec3 i = floor(v + dot(v, C.yyy));
		vec3 x0 = v - i + dot(i, C.xxx);
		vec3 g = step(x0.yzx, x0.xyz);
		vec3 l = 1.0 - g;
		vec3 i1 = min(g.xyz, l.zxy);
		vec3 i2 = max(g.xyz, l.zxy);
		vec3 x1 = x0 - i1 + C.xxx;
		vec3 x2 = x0 - i2 + 2.0 * C.xxx;
		vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
		i = mod(i, 289.0);
		vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
		float n_ = 1.0 / 7.0;
		vec3 ns = n_ * D.wyz - D.xzx;
		vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
		vec4 x_ = floor(j * ns.z);
		vec4 y_ = floor(j - 7.0 * x_);
		vec4 x = x_ * ns.x + ns.yyyy;
		vec4 y = y_ * ns.x + ns.yyyy;
		vec4 h = 1.0 - abs(x) - abs(y);
		vec4 b0 = vec4(x.xy, y.xy);
		vec4 b1 = vec4(x.zw, y.zw);
		vec4 s0 = floor(b0) * 2.0 + 1.0;
		vec4 s1 = floor(b1) * 2.0 + 1.0;
		vec4 sh = -step(h, vec4(0.0));
		vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
		vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
		vec3 p0 = vec3(a0.xy, h.x);
		vec3 p1 = vec3(a0.zw, h.y);
		vec3 p2 = vec3(a1.xy, h.z);
		vec3 p3 = vec3(a1.zw, h.w);
		vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
		p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
		vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
		m *= m;
		return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
	}

	void main() {
		vec3 normal = normalize(position);
		// Slow breathing, rolling solar cells and fine filaments give the ring a
		// living surface even between beats. Each layer moves at a different rate
		// so the contour keeps evolving without looking like a rigid rotation.
		float breathing = (sin(uTime * 0.82) * 0.038 + sin(uTime * 0.31) * 0.024) * (1.0 + uLow * 1.5);
		float drift = snoise(position * 0.3 + vec3(-uTime * 0.07, uTime * 0.1, uTime * 0.05));
		float broadWave = snoise(position * 0.56 + vec3(uTime * 0.18, -uTime * 0.11, uTime * 0.07));
		float filament = snoise(position * 1.92 - vec3(uTime * 0.09, uTime * 0.22, -uTime * 0.12));
		float thread = sin(dot(position, vec3(3.7, 5.1, 2.9)) + uTime * 2.4);
		float orbitalWave = sin(atan(normal.y, normal.x) * 7.0 - uTime * 1.1 + normal.z * 4.0);
		float deformation = breathing + drift * (0.09 + uMid * 0.09) + broadWave * (0.19 + uMid * 0.16)
			+ filament * (0.1 + uHigh * 0.12) + thread * (0.024 + uHigh * 0.052)
			+ orbitalWave * (0.032 + uMid * 0.045) + uLow * 0.09;
		vec3 finalPosition = position + normal * deformation;
		vec4 mvPosition = modelViewMatrix * vec4(finalPosition, 1.0);
		vec3 viewNormal = normalize(normalMatrix * normal);
		vec3 viewDirection = normalize(-mvPosition.xyz);
		float fresnel = 1.0 - abs(dot(viewNormal, viewDirection));
		// Only the tangent edge survives. This is what keeps the center entirely
		// hollow and turns the point cloud into the circular Solaris silhouette.
		float rim = smoothstep(0.26, 0.74, fresnel);
		float filamentCrest = smoothstep(0.18 - uHigh * 0.08, 0.82, broadWave * 0.58 + filament * 0.32 + orbitalWave * 0.1);
		// Each detected kick drives one local solar prominence along the rim.
		float beatDistance = distance(finalPosition, uBeatTarget);
		float beatFalloff = 1.0 - smoothstep(0.0, uBeatRadius, beatDistance);
		beatFalloff = pow(beatFalloff, 1.45);
		float flicker = 0.68 + 0.32 * snoise(position * 3.15 + uTime * 4.2);
		float flare = beatFalloff * uBeatStrength * flicker;
		finalPosition += normal * flare * uBeatFlare;
		mvPosition = modelViewMatrix * vec4(finalPosition, 1.0);
		float heat = clamp(filamentCrest * rim * 0.58 + flare * uBeatHeat, 0.0, 1.0);
		float gradient = smoothstep(-2.0, 2.0, position.y + position.x * 0.28);
		vec3 base = mix(uColorBottom, uColorTop, gradient);
		vColor = mix(base, uAccent, clamp(filamentCrest * rim * 0.3, 0.0, 0.3));
		vHeat = heat;
		vCrest = filamentCrest * rim;
		float sparkle = 0.86 + (0.14 + uHigh * 0.18) * sin(dot(position, vec3(8.3, 11.7, 5.9)) + uTime * (4.4 + uHigh * 4.0));
		vAlpha = rim * (0.54 + filamentCrest * 0.54)
			* (0.78 + gradient * 0.22) * sparkle;
		vAlpha += flare * 0.72;
		gl_PointSize = max(1.18, (8.5 / -mvPosition.z) * (1.0 + vCrest * 0.18 + uHigh * 0.36 + flare * 1.55));
		gl_Position = projectionMatrix * mvPosition;
	}
`;

const fragmentShader = /* glsl */ `
	varying float vAlpha;
	varying float vHeat;
	varying float vCrest;
	varying vec3 vColor;
	void main() {
		vec2 point = gl_PointCoord - vec2(0.5);
		float distanceToCenter = length(point);
		if (distanceToCenter > 0.5) discard;
		float core = smoothstep(0.36, 0.015, distanceToCenter);
		float glow = smoothstep(0.5, 0.09, distanceToCenter);
		vec3 color = mix(vColor, vec3(1.0, 0.97, 0.9), clamp(vHeat * 0.52 + vCrest * 0.18, 0.0, 0.78));
		gl_FragColor = vec4(color, vAlpha * (core * 0.82 + glow * 0.18));
	}
`;

// A single four-vertex plane produces the broad bloom-like aura. It gives the
// Solaris its luminous volume without the multiple render targets and blur
// passes of UnrealBloom, which were the main risk for the compact player.
const haloVertexShader = /* glsl */ `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const haloFragmentShader = /* glsl */ `
	uniform float uTime;
	uniform float uLow;
	uniform float uMid;
	uniform float uHigh;
	uniform vec3 uColorTop;
	uniform vec3 uColorBottom;
	uniform vec3 uAccent;
	varying vec2 vUv;
	void main() {
		vec2 point = (vUv - 0.5) * 2.0;
		float radius = length(point);
		float pulse = 1.0 + uLow * 0.055 + uMid * 0.018;
		// The reference's glow lives around the perimeter only. Leaving the
		// center at alpha zero preserves the black hollow of the particle ring.
		float ring = exp(-pow((radius - (0.725 * pulse)) / 0.105, 2.0));
		float outerRing = exp(-pow((radius - (0.79 * pulse)) / 0.19, 2.0));
		float flicker = 0.94 + (0.06 + uHigh * 0.1) * sin(uTime * (4.2 + uHigh * 4.0) + point.y * 3.0);
		vec3 gradient = mix(uColorBottom, uColorTop, smoothstep(-0.75, 0.75, point.y + point.x * 0.2));
		vec3 color = mix(gradient, uAccent, 0.2 + ring * 0.28);
		color = mix(color, vec3(1.0, 0.94, 0.82), ring * 0.18);
		float alpha = (outerRing * (0.075 + uMid * 0.022) + ring * (0.19 + uLow * 0.035))
			* flicker;
		gl_FragColor = vec4(color, alpha);
	}
`;

export class SolarisPlayer {
	constructor(canvas) {
		this.canvas = canvas;
		this.controls = { ...DEFAULT_CONTROLS };
		this.scene = new Scene();
		this.camera = new PerspectiveCamera(43, 1, 0.1, 100);
		this.camera.position.z = this.controls.cameraDistance;
		this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
		this.renderer.setClearColor(0x000000, 0);
		// The reference is a fine, continuous mesh of dots. This is dense enough
		// for its filament-like rim while remaining viable inside the compact player.
		this.geometry = new SphereGeometry(4.2, 160, 360);
		this.material = new ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uLow: { value: 0 },
				uMid: { value: 0 },
				uHigh: { value: 0 },
				uBeatTarget: { value: new Vector3(4.2, 0, 0) },
				uBeatStrength: { value: 0 },
				uBeatRadius: { value: this.controls.beatRadius },
				uBeatFlare: { value: this.controls.beatFlare },
				uBeatHeat: { value: this.controls.beatHeat },
				uColorTop: { value: new Color(DEFAULT_PALETTE.top) },
				uColorBottom: { value: new Color(DEFAULT_PALETTE.bottom) },
				uAccent: { value: new Color(DEFAULT_PALETTE.accent) },
			},
			vertexShader,
			fragmentShader,
			transparent: true,
			blending: AdditiveBlending,
			depthWrite: false,
		});
		this.particles = new Points(this.geometry, this.material);
		this.particles.frustumCulled = false;
		this.haloGeometry = new PlaneGeometry(11.8, 11.8);
		this.haloMaterial = new ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uLow: { value: 0 },
				uMid: { value: 0 },
				uHigh: { value: 0 },
				uColorTop: { value: new Color(DEFAULT_PALETTE.top) },
				uColorBottom: { value: new Color(DEFAULT_PALETTE.bottom) },
				uAccent: { value: new Color(DEFAULT_PALETTE.accent) },
			},
			vertexShader: haloVertexShader,
			fragmentShader: haloFragmentShader,
			transparent: true,
			blending: AdditiveBlending,
			depthWrite: false,
			depthTest: false,
		});
		this.halo = new Mesh(this.haloGeometry, this.haloMaterial);
		this.halo.position.z = -1.18;
		this.scene.add(this.halo);
		this.scene.add(this.particles);
		this.audioContext = null;
		this.analyser = null;
		this.frequencyData = null;
		this.spectrumHistory = null;
		this.spectrumHistoryCount = 0;
		this.spectrumHistoryIndex = 0;
		this.onsetHistory = new Float32Array(43);
		this.onsetHistoryCount = 0;
		this.onsetHistoryIndex = 0;
		this.onsetHistorySum = 0;
		this.onsetHistorySquares = 0;
		this.lastBeatTime = -Infinity;
		this.previousOnset = 0;
		this.beatArmed = false;
		this.quietFrames = 0;
		this.pendingPeak = 0;
		this.pendingPeakTime = 0;
		this.beatIndex = 0;
		this.beatTarget = new Vector3(4.2, 0, 0);
		this.audio = null;
		this.playing = false;
		this.beat = 0;
		this.lowLevel = 0;
		this.midLevel = 0;
		this.highLevel = 0;
		this.active = false;
		this.destroyed = false;
		this.animationFrame = null;
		this.lastRenderTime = 0;
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(canvas.parentElement || canvas);
		this.resize();
		this.lastFrame = performance.now();
		this.lastAudioFrame = this.lastFrame;
		this.renderFrame = this.renderFrame.bind(this);
		this.handleVisibilityChange = () => {
			if (document.hidden) this.stopLoop();
			else if (this.active) this.startLoop();
		};
		document.addEventListener('visibilitychange', this.handleVisibilityChange);
	}

	attachAudio(audio) {
		this.audio = audio;
	}

	prepareAudio() {
		if (!this.audio || this.audioContext) return this.audioContext?.resume() || Promise.resolve();
		const AudioContextClass = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextClass) return Promise.resolve();
		this.audioContext = new AudioContextClass();
		const source = this.audioContext.createMediaElementSource(this.audio);
		this.analyser = this.audioContext.createAnalyser();
		this.analyser.fftSize = 2048;
		// Keep the analyser unsmoothed. A short temporal baseline below handles
		// harmonic rejection without blurring the drum's attack transient.
		this.analyser.smoothingTimeConstant = 0;
		this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
		this.spectrumHistory = Array.from({ length: 5 }, () => new Float32Array(this.analyser.frequencyBinCount));
		source.connect(this.analyser);
		this.analyser.connect(this.audioContext.destination);
		return this.audioContext.resume();
	}

	setPlaying(playing) {
		this.playing = playing;
		if (playing) return;
		// A new track must not inherit the old track's transient baseline.
		this.beat = 0;
		this.lowLevel = 0;
		this.midLevel = 0;
		this.highLevel = 0;
		this.previousOnset = 0;
		this.beatArmed = false;
		this.quietFrames = 0;
		this.pendingPeak = 0;
		this.pendingPeakTime = 0;
		this.onsetHistory.fill(0);
		this.onsetHistoryCount = 0;
		this.onsetHistoryIndex = 0;
		this.onsetHistorySum = 0;
		this.onsetHistorySquares = 0;
		this.spectrumHistory?.forEach((frame) => frame.fill(0));
		this.spectrumHistoryCount = 0;
		this.spectrumHistoryIndex = 0;
	}

	startLoop() {
		if (this.destroyed || !this.active || document.hidden || this.animationFrame !== null) return;
		this.lastFrame = performance.now();
		this.lastAudioFrame = this.lastFrame;
		this.lastRenderTime = 0;
		this.animationFrame = requestAnimationFrame(this.renderFrame);
	}

	stopLoop() {
		if (this.animationFrame === null) return;
		cancelAnimationFrame(this.animationFrame);
		this.animationFrame = null;
	}

	setActive(active) {
		if (this.destroyed || this.active === Boolean(active)) return;
		this.active = Boolean(active);
		if (this.active) {
			this.resize();
			this.startLoop();
		} else {
			this.stopLoop();
		}
	}

	setPalette(palette = {}) {
		const next = { ...DEFAULT_PALETTE, ...palette };
		[this.material, this.haloMaterial].forEach((material) => {
			material.uniforms.uColorTop.value.set(next.top);
			material.uniforms.uColorBottom.value.set(next.bottom);
			material.uniforms.uAccent.value.set(next.accent);
		});
	}

	triggerBeat(intensity) {
		this.beatIndex += 1;
		// Golden-angle stepping distributes consecutive flares around the visible
		// tangent edge instead of concentrating every kick in one fixed spot.
		const angle = this.beatIndex * 2.399963229728653;
		this.beatTarget.set(Math.cos(angle) * 4.16, Math.sin(angle) * 4.16, 0);
		// Apply the target immediately, so both the outward flare and its
		// white-hot heat peak land on the same detected kick.
		this.material.uniforms.uBeatTarget.value.copy(this.beatTarget);
		this.beat = Math.max(this.beat, Math.min(1, 0.72 + intensity * 0.28));
	}

	readBeat(now, delta) {
		this.beat = Math.max(0, this.beat - delta * 2.35);
		if (!this.playing || !this.analyser || !this.frequencyData || !this.spectrumHistory) {
			this.lowLevel *= 0.92;
			this.midLevel *= 0.9;
			this.highLevel *= 0.88;
			return;
		}
		this.analyser.getByteFrequencyData(this.frequencyData);
		const binHz = this.audioContext.sampleRate / this.analyser.fftSize;
		const kickEnd = Math.min(this.frequencyData.length, Math.ceil(180 / binHz));
		const snareEnd = Math.min(this.frequencyData.length, Math.ceil(2500 / binHz));
		const cymbalEnd = Math.min(this.frequencyData.length, Math.ceil(10000 / binHz));
		const kickClickStart = Math.min(this.frequencyData.length, Math.floor(1800 / binHz));
		const kickClickEnd = Math.min(this.frequencyData.length, Math.ceil(4500 / binHz));
		const firstBin = Math.max(1, Math.floor(35 / binHz));
		const baselineFrames = this.spectrumHistoryCount;
		const baseline = this.spectrumHistory;
		const writeFrame = baseline[this.spectrumHistoryIndex];
		let kickTransient = 0;
		let snareTransient = 0;
		let cymbalTransient = 0;
		let kickClickTransient = 0;
		let snareMagnitude = 0;
		let cymbalMagnitude = 0;
		let snareLogMagnitude = 0;
		let cymbalLogMagnitude = 0;
		let lowEnergySquared = 0;
		let midEnergySquared = 0;
		let highEnergySquared = 0;
		for (let index = firstBin; index < cymbalEnd; index += 1) {
			const value = this.frequencyData[index] / 255;
			let harmonicBaseline = 0;
			for (let frame = 0; frame < baselineFrames; frame += 1) harmonicBaseline += baseline[frame][index];
			harmonicBaseline /= Math.max(baselineFrames, 1);
			const transient = Math.max(0, value - harmonicBaseline);
			writeFrame[index] = value;
			if (index < kickEnd) {
				kickTransient += transient;
				lowEnergySquared += value * value;
			} else if (index < snareEnd) {
				snareTransient += transient;
				snareMagnitude += value;
				snareLogMagnitude += Math.log(value + 0.0001);
				midEnergySquared += value * value;
			} else {
				cymbalTransient += transient;
				cymbalMagnitude += value;
				cymbalLogMagnitude += Math.log(value + 0.0001);
				highEnergySquared += value * value;
			}
			if (index >= kickClickStart && index < kickClickEnd) kickClickTransient += transient;
		}
		const kickCount = Math.max(kickEnd - firstBin, 1);
		const snareCount = Math.max(snareEnd - kickEnd, 1);
		const cymbalCount = Math.max(cymbalEnd - snareEnd, 1);
		const clickCount = Math.max(kickClickEnd - kickClickStart, 1);
		// These are continuous RMS levels, intentionally separate from the
		// transient detector below. Sustained instruments can now animate the
		// orb without generating false drum flares.
		const lowTarget = Math.min(1, Math.sqrt(lowEnergySquared / kickCount) * 1.95);
		const midTarget = Math.min(1, Math.sqrt(midEnergySquared / snareCount) * 2.05);
		const highTarget = Math.min(1, Math.sqrt(highEnergySquared / cymbalCount) * 2.45);
		const followBand = (current, target, attack, release) => current + (target - current) * (target > current ? attack : release);
		this.lowLevel = followBand(this.lowLevel, lowTarget, 0.26, 0.075);
		this.midLevel = followBand(this.midLevel, midTarget, 0.22, 0.09);
		this.highLevel = followBand(this.highLevel, highTarget, 0.3, 0.12);
		const snareFlatness = Math.exp(snareLogMagnitude / snareCount) / Math.max(snareMagnitude / snareCount, 0.0001);
		const cymbalFlatness = Math.exp(cymbalLogMagnitude / cymbalCount) / Math.max(cymbalMagnitude / cymbalCount, 0.0001);
		// The percussive residual removes steady harmonic components (bass notes,
		// guitar and vocals). Spectral flatness then favours the noise-like snare
		// and cymbal signatures over tonal instrument attacks.
		const kickScore = (kickTransient / kickCount) * (0.6 + Math.min(0.4, (kickClickTransient / clickCount) * 5));
		const snareScore = (snareTransient / snareCount) * snareFlatness;
		const cymbalScore = (cymbalTransient / cymbalCount) * cymbalFlatness;
		const onset = kickScore * 1.35 + snareScore * 0.95 + cymbalScore * 0.22;

		const historyLength = Math.max(this.onsetHistoryCount, 1);
		const mean = this.onsetHistorySum / historyLength;
		const variance = Math.max(0, this.onsetHistorySquares / historyLength - mean * mean);
		const deviation = Math.sqrt(variance);
		const threshold = mean + Math.max(0.008, deviation * 1.2);
		const releaseThreshold = mean + Math.max(0.003, deviation * 0.3);
		if (!this.beatArmed) {
			this.quietFrames = onset < releaseThreshold ? this.quietFrames + 1 : 0;
			if (this.quietFrames >= 3) this.beatArmed = true;
		}
		const isRising = onset > this.previousOnset * 1.04;
		const canTrigger = this.beatArmed && this.onsetHistoryCount >= 7 && now - this.lastBeatTime > 0.12;
		const drumGate = kickScore > 0.009 || snareScore > 0.006 || cymbalScore > 0.008;
		const candidate = canTrigger && drumGate && isRising && onset > threshold;
		if (candidate) {
			this.pendingPeak = Math.max(this.pendingPeak, onset);
			this.pendingPeakTime = now;
		}
		// Peak-picking confirms the end of the attack before firing. This short
		// confirmation window prevents a ripple in one drum hit from becoming two.
		if (this.pendingPeak > 0 && (!candidate || onset < this.pendingPeak * 0.94) && now - this.pendingPeakTime >= 0.016) {
			this.triggerBeat(Math.min(1, (this.pendingPeak - threshold) / Math.max(threshold, 0.06)));
			this.lastBeatTime = now;
			this.beatArmed = false;
			this.quietFrames = 0;
			this.pendingPeak = 0;
			this.pendingPeakTime = 0;
		}
		if (!this.beatArmed && this.pendingPeak > 0 && now - this.pendingPeakTime > 0.18) this.pendingPeak = 0;
		this.previousOnset = onset;
		const replaced = this.onsetHistoryCount === this.onsetHistory.length
			? this.onsetHistory[this.onsetHistoryIndex]
			: 0;
		this.onsetHistorySum += onset - replaced;
		this.onsetHistorySquares += onset * onset - replaced * replaced;
		this.onsetHistory[this.onsetHistoryIndex] = onset;
		this.onsetHistoryIndex = (this.onsetHistoryIndex + 1) % this.onsetHistory.length;
		this.onsetHistoryCount = Math.min(this.onsetHistoryCount + 1, this.onsetHistory.length);
		this.spectrumHistoryIndex = (this.spectrumHistoryIndex + 1) % this.spectrumHistory.length;
		this.spectrumHistoryCount = Math.min(this.spectrumHistoryCount + 1, this.spectrumHistory.length);
	}

	resize() {
		if (this.destroyed) return;
		const parent = this.canvas.parentElement || this.canvas;
		const width = Math.max(1, parent.clientWidth);
		const height = Math.max(1, parent.clientHeight);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height, false);
	}

	renderFrame(now) {
		this.animationFrame = null;
		if (this.destroyed || !this.active || document.hidden) return;
		this.animationFrame = requestAnimationFrame(this.renderFrame);
		const audioDelta = Math.min(0.05, (now - this.lastAudioFrame) / 1000);
		this.lastAudioFrame = now;
		this.readBeat(now / 1000, audioDelta);
		if (now - this.lastRenderTime < TARGET_FRAME_INTERVAL) return;
		const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
		this.lastFrame = now;
		this.lastRenderTime = now;
		const uniforms = this.material.uniforms;
		uniforms.uTime.value += delta * this.controls.noiseSpeed * 0.3;
		uniforms.uLow.value += (this.lowLevel - uniforms.uLow.value) * 0.24;
		uniforms.uMid.value += (this.midLevel - uniforms.uMid.value) * 0.2;
		uniforms.uHigh.value += (this.highLevel - uniforms.uHigh.value) * 0.28;
		uniforms.uBeatStrength.value = this.beat;
		this.haloMaterial.uniforms.uTime.value = uniforms.uTime.value;
		this.haloMaterial.uniforms.uLow.value = uniforms.uLow.value;
		this.haloMaterial.uniforms.uMid.value = uniforms.uMid.value;
		this.haloMaterial.uniforms.uHigh.value = uniforms.uHigh.value;
		this.halo.scale.setScalar(1 + this.beat * 0.085);
		this.renderer.render(this.scene, this.camera);
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.stopLoop();
		document.removeEventListener('visibilitychange', this.handleVisibilityChange);
		this.resizeObserver.disconnect();
		this.geometry.dispose();
		this.material.dispose();
		this.haloGeometry.dispose();
		this.haloMaterial.dispose();
		this.audioContext?.close();
		this.renderer.dispose();
		this.renderer.forceContextLoss?.();
	}
}
