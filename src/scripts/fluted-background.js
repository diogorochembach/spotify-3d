import {
	Color,
	Mesh,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	SRGBColorSpace,
	Vector2,
	WebGLRenderer,
} from 'three';

const DEFAULT_PALETTE = { top: '#6fbd64', accent: '#36a84a', bottom: '#0d4f2c' };
const MAX_PIXEL_RATIO = 1.5;
const TARGET_FRAME_INTERVAL = 1000 / 30;

function variantPalette(palette) {
	const deep = new Color(palette.bottom);
	const mid = new Color(palette.accent);
	const top = new Color(palette.top);
	return {
		voidColor: deep.clone().multiplyScalar(0.3),
		plum: deep.clone().lerp(mid, 0.22),
		lavender: mid.clone().lerp(top, 0.2),
		mauve: mid.clone().lerp(top, 0.52),
		deep,
		red: mid.clone().lerp(top, 0.45),
		hot: top.clone().lerp(new Color('#ffffff'), 0.24),
	};
}

const vertexShader = /* glsl */ `
	void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Fluted Veil keeps the original vertical-lens character, but folds the field
// with three compact FBM passes instead of recomputing five warped fields per pixel.
const fragmentShader = /* glsl */ `
	precision highp float;
	#define PI 3.14159265
	uniform vec2 uRes;
	uniform float uTime;
	uniform vec3 ucVoid, ucPlum, ucLav, ucMauve, ucDeep, ucRed, ucHot;

	float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
	float noise(vec2 p) {
		vec2 i = floor(p), f = fract(p); float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
		vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	}
	float fbm(vec2 p) {
		float sum = 0.0, amplitude = 0.5;
		for (int i = 0; i < 4; i++) { sum += amplitude * noise(p); p = p * 2.02 + vec2(11.3, 7.7); amplitude *= 0.5; }
		return sum;
	}
	vec3 heatRamp(float heat) {
		heat = clamp(heat, 0.0, 1.0); vec3 color = ucVoid;
		color = mix(color, ucPlum, smoothstep(0.00, 0.16, heat));
		color = mix(color, ucLav, smoothstep(0.16, 0.40, heat));
		color = mix(color, ucMauve, smoothstep(0.40, 0.55, heat));
		color = mix(color, ucDeep, smoothstep(0.55, 0.68, heat));
		color = mix(color, ucRed, smoothstep(0.68, 0.84, heat));
		return mix(color, ucHot, smoothstep(0.84, 1.00, heat));
	}
	float fieldHeat(vec2 uv) {
		vec2 p = uv - 0.5; p.x *= uRes.x / uRes.y; p *= 2.3;
		float t = uTime * 0.08; vec2 fp = p + vec2(0.0, t * 0.4);
		vec2 warp = vec2(fbm(fp * 1.68), fbm(fp * 1.68 + vec2(3.1, 1.7)));
		float n = fbm(fp * 1.68 + (warp - 0.5) * 1.0);
		float bend = (n * 2.0 - 1.0) * 4.75 + sin(p.x * 1.7 + t) * 0.8;
		float wave = sin(p.y * 6.5 + bend + uTime * 0.34);
		float ridge = pow(max(0.0, 1.0 - abs(wave)), 2.5);
		return 0.1 + (n - 0.5) * 2.0 + ridge * 0.43 + 0.59 * (1.0 - uv.x);
	}
	void main() {
		vec2 uv = gl_FragCoord.xy / uRes;
		float flute = uv.x * 44.0; float fluteIndex = floor(flute); float lens = fract(flute) - 0.5;
		float jitter = (hash(vec2(fluteIndex, 7.3)) - 0.5) * 0.4;
		float refraction = (-sin(lens * PI) * 0.9) / 44.0;
		vec2 sampleUv = uv + vec2(refraction + jitter / 44.0, 0.0);
		vec3 color = heatRamp(fieldHeat(sampleUv)) * 0.89;
		float edge = abs(lens) * 2.0;
		float groove = smoothstep(0.6, 1.0, edge);
		color *= 1.0 - 0.53 * groove;
		float seam = smoothstep(0.86, 1.0, edge);
		color += seam * 0.25 * vec3(1.0, 0.93, 0.9);
		color += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.055;
		gl_FragColor = vec4(color, 1.0);
	}
`;

export class FlutedBackground {
	constructor(canvas) {
		this.canvas = canvas;
		this.scene = new Scene();
		this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
		this.renderer.outputColorSpace = SRGBColorSpace;
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
		this.renderer.setClearColor(0x000000, 1);
		this.geometry = new PlaneGeometry(2, 2);
		this.material = new ShaderMaterial({
			uniforms: {
				uRes: { value: new Vector2(1, 1) },
				uTime: { value: 0 },
				ucVoid: { value: new Color() },
				ucPlum: { value: new Color() },
				ucLav: { value: new Color() },
				ucMauve: { value: new Color() },
				ucDeep: { value: new Color() },
				ucRed: { value: new Color() },
				ucHot: { value: new Color() },
			},
			vertexShader,
			fragmentShader,
			depthTest: false,
			depthWrite: false,
		});
		this.quad = new Mesh(this.geometry, this.material);
		this.quad.frustumCulled = false;
		this.scene.add(this.quad);
		this.active = false;
		this.destroyed = false;
		this.animationFrame = null;
		this.lastFrame = 0;
		this.lastRenderTime = 0;
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(canvas.parentElement || canvas);
		this.resize();
		this.renderFrame = this.renderFrame.bind(this);
		this.handleVisibilityChange = () => {
			if (document.hidden) this.stopLoop();
			else if (this.active) this.startLoop();
		};
		document.addEventListener('visibilitychange', this.handleVisibilityChange);
	}

	setPalette(palette = {}) {
		const colors = variantPalette({ ...DEFAULT_PALETTE, ...palette });
		this.material.uniforms.ucVoid.value.copy(colors.voidColor);
		this.material.uniforms.ucPlum.value.copy(colors.plum);
		this.material.uniforms.ucLav.value.copy(colors.lavender);
		this.material.uniforms.ucMauve.value.copy(colors.mauve);
		this.material.uniforms.ucDeep.value.copy(colors.deep);
		this.material.uniforms.ucRed.value.copy(colors.red);
		this.material.uniforms.ucHot.value.copy(colors.hot);
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

	startLoop() {
		if (this.destroyed || !this.active || document.hidden || this.animationFrame !== null) return;
		this.lastFrame = performance.now();
		this.lastRenderTime = 0;
		this.animationFrame = requestAnimationFrame(this.renderFrame);
	}

	stopLoop() {
		if (this.animationFrame === null) return;
		cancelAnimationFrame(this.animationFrame);
		this.animationFrame = null;
	}

	resize() {
		if (this.destroyed) return;
		const parent = this.canvas.parentElement || this.canvas;
		const width = Math.max(1, parent.clientWidth);
		const height = Math.max(1, parent.clientHeight);
		this.renderer.setSize(width, height, false);
		this.material.uniforms.uRes.value.set(width * this.renderer.getPixelRatio(), height * this.renderer.getPixelRatio());
	}

	renderFrame(now) {
		this.animationFrame = null;
		if (this.destroyed || !this.active || document.hidden) return;
		this.animationFrame = requestAnimationFrame(this.renderFrame);
		if (now - this.lastRenderTime < TARGET_FRAME_INTERVAL) return;
		const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
		this.lastFrame = now;
		this.lastRenderTime = now;
		this.material.uniforms.uTime.value += delta;
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
		this.renderer.dispose();
		this.renderer.forceContextLoss?.();
	}
}
