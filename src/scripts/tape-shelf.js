import {
	Scene,
	PerspectiveCamera,
	WebGLRenderer,
	AmbientLight,
	DirectionalLight,
	HemisphereLight,
	MeshPhysicalMaterial,
	CylinderGeometry,
	ExtrudeGeometry,
	Shape,
	Path,
	Mesh,
	Group,
	CanvasTexture,
	Raycaster,
	Vector2,
	Vector3,
	Color,
	Clock,
	NoColorSpace,
	SRGBColorSpace,
	RepeatWrapping,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Constantes de dimensão
// SPINE_WIDTH = 4.25 e SPINE_HEIGHT = 0.52: na vista de coleção a fita aparece deitada, mostrando a lombada longa; 0.52 de altura é grosso o bastante para não parecer uma tira esticada.
const SPINE_WIDTH = 4.25;
const SPINE_HEIGHT = 0.52;
// SPINE_DEPTH = SPINE_WIDTH / 1.56: uma carcaça real de cassete mede ~100 mm × 64 mm, ou seja ~1.56:1. Essa é a proporção da face +y ("topo") quando ela é inclinada em direção à câmera. Se a profundidade fosse a fatia fina que a metáfora de "lombada de livro" sugere, a face impressa sairia esticada e cortada nas bordas quando focada. Resultado ≈ 2.7244.
const SPINE_DEPTH = SPINE_WIDTH / 1.56;
// SHELL_RADIUS = 0.15 e SHELL_SEGMENTS = 8: carcaças de cassete são plástico injetado — toda aresta e canto é suavemente arredondado, não 90° duro. Use um único raio compartilhado, ligeiramente cheio, para todas as arestas, para que frente, topo e laterais leiam como um corpo injetado contínuo. Os segmentos extras deixam a silhueta lisa sem alterar as dimensões externas.
const SHELL_RADIUS = 0.15;
const SHELL_SEGMENTS = 8;
// GAP = 0.4: espaço vertical entre fitas empilhadas.
const GAP = 0.4;
// LIST_PITCH = -0.26 e LIST_CAMERA_OFFSET = 2.1: apenas declarados para consumo posterior pelo prompt de câmera.
const LIST_PITCH = -0.26;
const LIST_CAMERA_OFFSET = 2.1;
// LABEL_H = Math.round(LABEL_W * SPINE_HEIGHT / SPINE_WIDTH) = 251 px: casa a textura do rótulo com a proporção real da face +z para que a tipografia não fique horizontalmente distorcida quando o Three.js a mapeia na caixa arredondada.
const LABEL_W = 2048;
const LABEL_H = Math.round(LABEL_W * SPINE_HEIGHT / SPINE_WIDTH);
// FACE_H = Math.round(FACE_W / 1.56) = 1154 px: mesma proporção 1.56:1 da face superior.
const FACE_W = 1800;
const FACE_H = Math.round(FACE_W / 1.56);
// REEL_RADIUS, REEL_OFFSET_X, REEL_OFFSET_Z: posição/tamanho reais dos dois cubos de carretel na face +y, casando com a janela desenhada em drawCassetteFace.
const REEL_RADIUS = SPINE_DEPTH * 0.08;
const REEL_OFFSET_X = SPINE_WIDTH * 0.182;
const REEL_OFFSET_Z = SPINE_DEPTH * 0.16;
// CABLE_OUTLET_X/Y/Z: a saída de fone fica na aresta direita da carcaça, não na face impressa; o plugue portanto acompanha esse lado físico quando a fita gira.
const CABLE_OUTLET_X = SPINE_WIDTH / 2;
const CABLE_OUTLET_Y = -SPINE_HEIGHT * 0.12;
const CABLE_OUTLET_Z = SPINE_DEPTH * 0.4;
// REEL_Y = SPINE_HEIGHT / 2 + 0.002: mantém as peças móveis parcialmente afundadas na carcaça — as bordas superiores ainda pegam luz, mas os dentes leem como estando dentro da janela do cassete.
const REEL_Y = SPINE_HEIGHT / 2 + 0.002;
const REEL_SPIN_SPEED = 0.045;
const REEL_DEPTH = 0.008;
const REEL_CAVITY_DEPTH = 0.014;
const WINDOW_WIDTH = SPINE_WIDTH * 0.7;
const WINDOW_DEPTH = SPINE_DEPTH * 0.22;

// Funções utilitárias de cor
function mix(hex, target, amount) {
	const c = new Color(hex || '#888888');
	c.lerp(new Color(target), amount);
	return `#${c.getHexString()}`;
}

function luminance(hex) {
	const c = new Color(hex || '#888888');
	return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

function reelTint(hex) {
	const color = new Color(hex || '#888888');
	const hsl = {};
	color.getHSL(hsl);
	const shellIsDark = luminance(hex) < 0.42;
	const saturation = Math.min(0.78, Math.max(hsl.s, 0.18));
	const lightness = shellIsDark
		? Math.min(0.68, Math.max(0.5, hsl.l + 0.28))
		: Math.max(0.18, hsl.l - 0.25);
	color.setHSL(hsl.h, saturation, lightness);
	return `#${color.getHexString()}`;
}

function labelBackground(album) {
	const shell = album.color || '#888888';
	const shellIsDark = luminance(shell) < 0.3;
	return mix(shell, '#ffffff', shellIsDark ? 0.62 : 0.34);
}

function labelAccent(album) {
	const color = new Color(album.accent || album.color || '#d1a95a');
	const hsl = {};
	color.getHSL(hsl);
	color.setHSL(hsl.h, Math.max(0.34, hsl.s), Math.max(0.58, Math.min(0.74, hsl.l + 0.16)));
	return `#${color.getHexString()}`;
}

// Ruído semeado e mapas procedurais de superfície
function seededRandom(seed) {
	let state = 2166136261;
	for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
	return () => {
		state += state << 13;
		state ^= state >>> 7;
		state += state << 3;
		state ^= state >>> 17;
		state += state << 5;
		return (state >>> 0) / 4294967296;
	};
}

function fract(value) {
	return value - Math.floor(value);
}

function createValueNoise(seed, cells = 24) {
	const random = seededRandom(seed);
	const grid = Array.from({ length: cells }, () =>
		Array.from({ length: cells }, () => random()),
	);

	return (u, v, frequency = 1) => {
		const x = fract(u * frequency) * cells;
		const y = fract(v * frequency) * cells;
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const x1 = (x0 + 1) % cells;
		const y1 = (y0 + 1) % cells;
		const tx = x - x0;
		const ty = y - y0;
		const sx = tx * tx * (3 - 2 * tx);
		const sy = ty * ty * (3 - 2 * ty);
		const top = grid[y0][x0] * (1 - sx) + grid[y0][x1] * sx;
		const bottom = grid[y1][x0] * (1 - sx) + grid[y1][x1] * sx;
		return top * (1 - sy) + bottom * sy;
	};
}

function fbm(noise, u, v, frequency, octaves = 3) {
	let total = 0;
	let amplitude = 0.5;
	let normalization = 0;
	for (let i = 0; i < octaves; i += 1) {
		total += noise(u, v, frequency) * amplitude;
		normalization += amplitude;
		frequency *= 2;
		amplitude *= 0.5;
	}
	return total / normalization;
}

function createSurfaceMaps(seed, { paper = false } = {}) {
	const size = 128;
	const noise = createValueNoise(seed, 24);
	const heightAt = (u, v) => {
		const macro = fbm(noise, u, v, 2, 3);
		const micro = fbm(noise, u, v, paper ? 18 : 28, 2);
		if (!paper) return macro * 0.42 + micro * 0.58;
		const fibers = Math.sin((u * 64 + v * 5) * Math.PI * 2) * 0.5 + 0.5;
		return macro * 0.34 + micro * 0.46 + fibers * 0.2;
	};

	const roughCanvas = document.createElement('canvas');
	roughCanvas.width = size;
	roughCanvas.height = size;
	const normalCanvas = document.createElement('canvas');
	normalCanvas.width = size;
	normalCanvas.height = size;
	const roughContext = roughCanvas.getContext('2d');
	const normalContext = normalCanvas.getContext('2d');
	const roughData = roughContext.createImageData(size, size);
	const normalData = normalContext.createImageData(size, size);
	const encode = (value) => Math.max(0, Math.min(255, Math.round(value)));

	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const u = x / size;
			const v = y / size;
			const height = heightAt(u, v);
			const offset = (y * size + x) * 4;
			const roughness = paper
				? 0.82 + (height - 0.5) * 0.16
				: 0.65 + (height - 0.5) * 0.23;
			const dx = heightAt(u + 1 / size, v) - heightAt(u - 1 / size, v);
			const dy = heightAt(u, v + 1 / size) - heightAt(u, v - 1 / size);
			roughData.data[offset] = encode(roughness * 255);
			roughData.data[offset + 1] = encode(roughness * 255);
			roughData.data[offset + 2] = encode(roughness * 255);
			roughData.data[offset + 3] = 255;
			const normalStrength = paper ? 300 : 240;
			normalData.data[offset] = encode(128 - dx * normalStrength);
			normalData.data[offset + 1] = encode(128 - dy * normalStrength);
			normalData.data[offset + 2] = 255;
			normalData.data[offset + 3] = 255;
		}
	}

	roughContext.putImageData(roughData, 0, 0);
	normalContext.putImageData(normalData, 0, 0);
	const configureMap = (canvas, repeat) => {
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = NoColorSpace;
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
		texture.repeat.set(repeat, repeat);
		texture.anisotropy = 8;
		texture.needsUpdate = true;
		return texture;
	};
	return {
		roughnessMap: configureMap(roughCanvas, paper ? 2 : 3),
		normalMap: configureMap(normalCanvas, paper ? 2 : 3),
	};
}

// Helpers de canvas
function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function drawImageCover(ctx, img, x, y, w, h) {
	const scale = Math.max(w / img.width, h / img.height);
	const sw = w / scale;
	const sh = h / scale;
	const sx = (img.width - sw) / 2;
	const sy = (img.height - sh) / 2;
	ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// drawLabel(album, coverImage) — textura da lombada (+z), 2048 × 251
function drawLabel(album, coverImage) {
	const canvas = document.createElement('canvas');
	canvas.width = LABEL_W;
	canvas.height = LABEL_H;
	const ctx = canvas.getContext('2d');
	const width = canvas.width;
	const height = canvas.height;

	// 1. Cores
	const shell = album.color || '#888888';
	const accent = labelAccent(album);
	const darkLabel = mix(shell, '#07080a', 0.82);

	// 2. Fundo total
	ctx.fillStyle = '#08090a';
	ctx.fillRect(0, 0, width, height);

	// 3. Inset arredondado
	const inset = 16;
	roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 26);
	ctx.fillStyle = darkLabel;
	ctx.fill();

	// 4. Brilho (sheen) no mesmo caminho
	const sheen = ctx.createLinearGradient(0, 0, width, height);
	sheen.addColorStop(0, 'rgba(255,255,255,.13)');
	sheen.addColorStop(0.28, 'rgba(255,255,255,0)');
	sheen.addColorStop(1, 'rgba(0,0,0,.2)');
	ctx.fillStyle = sheen;
	ctx.fill();

	// 5. Barra de accent na borda esquerda
	ctx.fillStyle = accent;
	ctx.fillRect(inset, inset, 9, height - inset * 2);

	// 6. Grão semeado
	const grain = seededRandom(`${album.id || album.title}-spine`);
	ctx.save();
	roundRect(ctx, inset, inset, width - 32, height - 32, 26);
	ctx.clip();
	for (let i = 0; i < 900; i += 1) {
		const alpha = 0.012 + grain() * 0.022;
		ctx.fillStyle = grain() > 0.52 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
		ctx.fillRect(grain() * width, grain() * height, 1 + grain() * 2, 1 + grain());
	}
	ctx.restore();

	// 7. Miniatura da capa
	const coverSize = height - 54;
	const coverX = 46;
	const coverY = (height - coverSize) / 2;
	ctx.save();
	roundRect(ctx, coverX, coverY, coverSize, coverSize, 12);
	ctx.clip();
	if (coverImage) {
		drawImageCover(ctx, coverImage, coverX, coverY, coverSize, coverSize);
	} else {
		const coverGrad = ctx.createLinearGradient(coverX, coverY, coverX + coverSize, coverY + coverSize);
		coverGrad.addColorStop(0, accent);
		coverGrad.addColorStop(1, shell);
		ctx.fillStyle = coverGrad;
		ctx.fillRect(coverX, coverY, coverSize, coverSize);
		ctx.fillStyle = 'rgba(0,0,0,.38)';
		ctx.font = `700 ${Math.round(coverSize * 0.39)}px Georgia, serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText((album.title || '?').slice(0, 1).toUpperCase(), coverX + coverSize / 2, coverY + coverSize / 2);
	}
	ctx.restore();

	// Contorno da capa
	ctx.strokeStyle = 'rgba(255,255,255,.5)';
	ctx.lineWidth = 3;
	roundRect(ctx, coverX, coverY, coverSize, coverSize, 12);
	ctx.stroke();

	// 8. Tipografia
	const textX = coverX + coverSize + 38;
	const yearX = width - 54;

	// Artista
	ctx.fillStyle = accent;
	ctx.font = '700 23px "JetBrains Mono", monospace';
	ctx.letterSpacing = '3px';
	ctx.textBaseline = 'middle';
	ctx.fillText((album.artist || 'ARTISTA').toUpperCase(), textX, 68);

	ctx.letterSpacing = '0px';

	// Título
	ctx.fillStyle = '#fffdf7';
	ctx.font = '700 62px Georgia, "Times New Roman", serif';
	ctx.fillText(album.title || '', textX, 136, yearX - textX - 32);

	// Legenda
	ctx.fillStyle = 'rgba(255,255,255,.6)';
	ctx.font = '400 21px "JetBrains Mono", monospace';
	ctx.fillText('ARQUIVO DE FITAS · SIDE A', textX, 184);

	// Ano
	ctx.textAlign = 'right';
	ctx.fillStyle = accent;
	ctx.font = '700 26px "JetBrains Mono", monospace';
	ctx.fillText(String(album.year || ''), yearX, height / 2);
	ctx.textAlign = 'left';

	// 9. Textura de retorno
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

// drawIntegratedReel(ctx, x, y, radius, color) — carretel "assado" na textura (LOD da coleção)
function drawIntegratedReel(ctx, x, y, radius, color) {
	ctx.save();
	ctx.beginPath();
	ctx.arc(x, y, radius * 1.12, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(0,0,0,.76)';
	ctx.fill();

	ctx.beginPath();
	const points = 24;
	for (let index = 0; index <= points; index += 1) {
		const angle = (index / points) * Math.PI * 2;
		const outer = index % 2 === 0 ? radius : radius * 0.82;
		const px = x + Math.cos(angle) * outer;
		const py = y + Math.sin(angle) * outer;
		if (index === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();
	ctx.strokeStyle = 'rgba(255,255,255,.24)';
	ctx.lineWidth = Math.max(1, radius * 0.07);
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(x, y, radius * 0.31, 0, Math.PI * 2);
	ctx.fillStyle = '#0b0a09';
	ctx.fill();
	ctx.strokeStyle = 'rgba(255,255,255,.2)';
	ctx.stroke();
	ctx.restore();
}

// drawCassetteFace(album, coverImage) — textura da face superior (+y), 1800 × 1154
function drawCassetteFace(album, coverImage) {
	const canvas = document.createElement('canvas');
	canvas.width = FACE_W;
	canvas.height = FACE_H;
	const ctx = canvas.getContext('2d');

	const shell = album.color || '#c23b3b';
	const accent = album.accent || '#f2c14e';
	const ink = album.ink || '#f4ede0'; // declarada conforme contrato
	const w = canvas.width;
	const h = canvas.height;
	const r = w * 0.03;

	// 1. Carcaça
	roundRect(ctx, 0, 0, w, h, r);
	ctx.fillStyle = shell;
	ctx.fill();

	// 2. Sombreamento reaproveitando caminho
	const shading = ctx.createLinearGradient(0, 0, w, h);
	shading.addColorStop(0, 'rgba(255,255,255,.10)');
	shading.addColorStop(0.4, 'rgba(255,255,255,0)');
	shading.addColorStop(1, 'rgba(0,0,0,.16)');
	ctx.fillStyle = shading;
	ctx.fill();

	// 3. Início do clip da carcaça
	ctx.save();
	roundRect(ctx, 0, 0, w, h, r);
	ctx.clip();

	// 4. Grão plástico semeado
	const plasticGrain = seededRandom(`${album.id || album.title}-${shell}-plastic`);
	for (let i = 0; i < 850; i += 1) {
		const alpha = 0.012 + plasticGrain() * 0.025;
		ctx.fillStyle = plasticGrain() > 0.5
			? `rgba(255,255,255,${alpha})`
			: `rgba(0,0,0,${alpha})`;
		ctx.fillRect(plasticGrain() * w, plasticGrain() * h, 1 + plasticGrain() * 3, 1 + plasticGrain() * 2);
	}

	// 5. Placa escura
	const plateM = w * 0.032;
	const plateH = h * 0.52;
	roundRect(ctx, plateM, plateM, w - plateM * 2, plateH - plateM, w * 0.022);
	ctx.fillStyle = mix(shell, '#000000', 0.72);
	ctx.fill();

	// 6. Etiqueta "SIDE A"
	const tagW = w * 0.1;
	const tagH = plateH * 0.4;
	const tagX = plateM * 2.4;
	const tagY = plateM * 2.4;
	roundRect(ctx, tagX, tagY, tagW, tagH, w * 0.01);
	ctx.strokeStyle = 'rgba(255,255,255,.55)';
	ctx.lineWidth = w * 0.004;
	ctx.stroke();

	ctx.fillStyle = '#fff';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	ctx.font = `700 ${Math.round(h * 0.03)}px Arial, sans-serif`;
	ctx.fillText('SIDE', tagX + tagW / 2, tagY + tagH * 0.42);
	ctx.font = `700 ${Math.round(h * 0.06)}px Georgia, serif`;
	ctx.fillText('A', tagX + tagW / 2, tagY + tagH * 0.92);

	// 7. Geometria da foto e largura útil do texto
	const photoM = plateM * 1.4;
	const photoSize = plateH - photoM * 2;
	const photoX = w - plateM * 2.4 - photoSize;
	const photoY = photoM;
	const textMaxWidth = coverImage
		? photoX - (tagX + tagW) - plateM * 1.8
		: w - tagX - tagW - plateM * 3.4;

	// 8. Bloco título/artista
	ctx.textAlign = 'left';
	ctx.fillStyle = accent;
	const titleSize = Math.min(h * 0.09, textMaxWidth / Math.max((album.title || '').length, 6) * 1.7);
	ctx.font = `800 ${Math.round(titleSize)}px Georgia, serif`;
	ctx.fillText((album.title || '').toUpperCase(), tagX + tagW + plateM * 1.4, tagY + tagH * 0.62, textMaxWidth);

	ctx.fillStyle = 'rgba(255,255,255,.82)';
	ctx.font = `italic ${Math.round(h * 0.04)}px Georgia, serif`;
	ctx.fillText(album.artist || '', tagX + tagW + plateM * 1.4, tagY + tagH * 0.96, textMaxWidth);

	// 9. Foto quadrada da capa
	if (coverImage) {
		// Sombra
		ctx.save();
		ctx.shadowColor = 'rgba(0,0,0,.36)';
		ctx.shadowBlur = w * 0.012;
		ctx.shadowOffsetY = h * 0.008;
		roundRect(ctx, photoX, photoY, photoSize, photoSize, w * 0.008);
		ctx.fillStyle = 'rgba(255,255,255,.16)';
		ctx.fill();
		ctx.restore();

		// Imagem
		ctx.save();
		roundRect(ctx, photoX, photoY, photoSize, photoSize, w * 0.008);
		ctx.clip();
		drawImageCover(ctx, coverImage, photoX, photoY, photoSize, photoSize);
		ctx.restore();

		// Borda dupla
		ctx.strokeStyle = 'rgba(255,255,255,.48)';
		ctx.lineWidth = w * 0.0025;
		roundRect(ctx, photoX, photoY, photoSize, photoSize, w * 0.008);
		ctx.stroke();

		ctx.strokeStyle = 'rgba(0,0,0,.28)';
		ctx.lineWidth = w * 0.0015;
		roundRect(ctx, photoX + w * 0.006, photoY + h * 0.006, photoSize - w * 0.012, photoSize - h * 0.012, w * 0.006);
		ctx.stroke();
	}

	// 10. Três linhas pautadas
	ctx.strokeStyle = 'rgba(255,255,255,.18)';
	ctx.lineWidth = w * 0.0025;
	const lineStartX = tagX + tagW + plateM * 1.4;
	const lineEndX = coverImage ? photoX - photoM * 0.55 : w - plateM * 2.4;
	const lineStartY = tagY + tagH + h * 0.035;
	for (let i = 0; i < 3; i += 1) {
		const ly = lineStartY + i * (h * 0.04);
		ctx.beginPath();
		ctx.moveTo(lineStartX, ly);
		ctx.lineTo(lineEndX, ly);
		ctx.stroke();
	}

	// 11. Janela da fita
	const winW = w * 0.7;
	const winH = h * 0.19;
	const winX = (w - winW) / 2;
	const winY = plateH + h * 0.045;
	roundRect(ctx, winX, winY, winW, winH, h * 0.02);
	ctx.fillStyle = '#0b0a09';
	ctx.fill();

	ctx.strokeStyle = 'rgba(255,255,255,.16)';
	ctx.lineWidth = h * 0.005;
	roundRect(ctx, winX, winY, winW, winH, h * 0.02);
	ctx.stroke();

	// Degradê marrom da fita magnética
	const tapeGrad = ctx.createLinearGradient(winX, 0, winX + winW, 0);
	tapeGrad.addColorStop(0, 'rgba(120,86,52,.55)');
	tapeGrad.addColorStop(0.5, 'rgba(60,44,30,.3)');
	tapeGrad.addColorStop(1, 'rgba(120,86,52,.55)');
	ctx.fillStyle = tapeGrad;
	ctx.fillRect(winX + winW * 0.08, winY + winH * 0.42, winW * 0.84, winH * 0.16);

	// 12. Carretéis integrados (LOD)
	const integratedReelColor = reelTint(shell);
	drawIntegratedReel(ctx, winX + winW * 0.27, winY + winH * 0.5, winH * 0.34, integratedReelColor);
	drawIntegratedReel(ctx, winX + winW * 0.73, winY + winH * 0.5, winH * 0.34, integratedReelColor);

	// 13. Selos "HIGH QUALITY" / "STEREO"
	ctx.fillStyle = 'rgba(255,255,255,.85)';
	ctx.textAlign = 'left';
	ctx.font = `700 ${Math.round(h * 0.032)}px Arial, sans-serif`;
	ctx.fillText('HIGH QUALITY', winX, winY + winH + h * 0.05);
	ctx.textAlign = 'right';
	ctx.fillText('STEREO', winX + winW, winY + winH + h * 0.05);
	ctx.textAlign = 'left';

	// 14. Três pés inferiores + faixa de base
	const footY = h * 0.86;
	ctx.fillStyle = mix(shell, '#000000', 0.35);
	[0.1, 0.4, 0.7].forEach((f) => {
		roundRect(ctx, w * f, footY, w * 0.2, h * 0.1, h * 0.018);
		ctx.fill();
	});
	ctx.fillStyle = mix(shell, '#000000', 0.55);
	ctx.fillRect(0, h * 0.965, w, h * 0.035);

	// 15. Fim do clip
	ctx.restore();

	// 16. Borda externa
	roundRect(ctx, 0, 0, w, h, r);
	ctx.strokeStyle = 'rgba(0,0,0,.45)';
	ctx.lineWidth = w * 0.006;
	ctx.stroke();

	// 17. Quatro parafusos
	const screwR = w * 0.016;
	[
		[w * 0.045, h * 0.045],
		[w * 0.955, h * 0.045],
		[w * 0.045, h * 0.955],
		[w * 0.955, h * 0.955],
	].forEach(([sx, sy]) => {
		ctx.beginPath();
		ctx.arc(sx, sy, screwR, 0, Math.PI * 2);
		const g = ctx.createRadialGradient(sx - screwR * 0.3, sy - screwR * 0.3, screwR * 0.1, sx, sy, screwR);
		g.addColorStop(0, 'rgba(255,255,255,.5)');
		g.addColorStop(1, 'rgba(0,0,0,.6)');
		ctx.fillStyle = g;
		ctx.fill();
		ctx.strokeStyle = 'rgba(0,0,0,.5)';
		ctx.lineWidth = screwR * 0.22;
		ctx.beginPath();
		ctx.moveTo(sx - screwR * 0.55, sy);
		ctx.lineTo(sx + screwR * 0.55, sy);
		ctx.moveTo(sx, sy - screwR * 0.55);
		ctx.lineTo(sx, sy + screwR * 0.55);
		ctx.stroke();
	});

	// 18. Textura de retorno
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

// Geometrias das peças internas
function createToothedRingGeometry(radius, innerRadius, depth, teeth = 12) {
	const shape = new Shape();
	const points = teeth * 4;
	for (let i = 0; i <= points; i += 1) {
		const angle = (i / points) * Math.PI * 2;
		const phase = i % 4;
		const ring = phase === 1 || phase === 2 ? radius : radius * 0.76;
		const x = Math.cos(angle) * ring;
		const y = Math.sin(angle) * ring;
		if (i === 0) shape.moveTo(x, y);
		else shape.lineTo(x, y);
	}
	const hole = new Path();
	hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
	shape.holes.push(hole);
	const geometry = new ExtrudeGeometry(shape, {
		depth,
		bevelEnabled: true,
		bevelSegments: 2,
		bevelSize: 0.004,
		bevelThickness: 0.003,
		curveSegments: 3,
	});
	geometry.center();
	return geometry;
}

function createRingGeometry(outerRadius, innerRadius, depth) {
	const shape = new Shape();
	shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
	const hole = new Path();
	hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
	shape.holes.push(hole);
	const geometry = new ExtrudeGeometry(shape, {
		depth,
		bevelEnabled: true,
		bevelSegments: 2,
		bevelSize: 0.003,
		bevelThickness: 0.002,
		curveSegments: 32,
	});
	geometry.center();
	return geometry;
}

// Fábrica principal: exporta createTapeShelf
export function createTapeShelf({ container, albums, onSelect, layout = 'stack' }) {
	let destroyed = false;
	const isShelfLayout = layout === 'shelf';
	const totalHeight = albums.length * SPINE_HEIGHT + Math.max(albums.length - 1, 0) * GAP;
	const startY = totalHeight / 2 - SPINE_HEIGHT / 2;
	const scrollSpan = isShelfLayout ? 0 : Math.max(totalHeight - SPINE_HEIGHT, 0);
	const shelfGap = 0.16;
	const shelfWidth = albums.length * SPINE_HEIGHT + Math.max(albums.length - 1, 0) * shelfGap;

	const scene = new Scene();
	const camera = new PerspectiveCamera(36, 1, 0.1, 100);
	const CAMERA = {
		list: isShelfLayout ? { position: [0, 0, 10.4], fov: 32 } : { position: [0, 0, 9.6], fov: 32 },
		detail: { position: [0, 0.05, 10.8], fov: 36 },
	};
	camera.position.set(...CAMERA.list.position);

	const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.transmissionResolutionScale = 0.45;
	container.appendChild(renderer.domElement);
	renderer.domElement.style.display = 'block';
	renderer.domElement.style.width = '100%';
	renderer.domElement.style.height = '100%';

	scene.add(new AmbientLight(0xffffff, 0.6));
	const key = new DirectionalLight(0xfff3e0, 1.15);
	key.position.set(-3, 6, 6);
	scene.add(key);
	const fill = new DirectionalLight(0xbcd4ff, 0.35);
	fill.position.set(4, -2, -4);
	scene.add(fill);
	const hemisphere = new HemisphereLight(0xffe8c8, 0x18202b, 0.42);
	hemisphere.position.set(0, 5, 0);
	scene.add(hemisphere);

	const raycaster = new Raycaster();
	const pointer = new Vector2();
	const cableWorldPoint = new Vector3();
	const clock = new Clock();

	// Variáveis de estado do contrato
	let mode = 'list';
	let focusIndex = -1;
	let hoveredIndex = -1;
	let scrollProgress = 0;
	let isDragging = false;
	let dragPointerId = null;
	let dragStart = { x: 0, y: 0 };
	let dragRotation = { x: 0, y: 0 };
	let playingIndex = -1;
	let isPlaying = false;

	// Peças compartilhadas (uma instância só, reutilizada por todas as fitas)
	// O carretel é um anel de raio externo REEL_RADIUS * 0.92 e furo REEL_RADIUS * 0.32
	const reelGeometry = createToothedRingGeometry(REEL_RADIUS * 0.92, REEL_RADIUS * 0.32, REEL_DEPTH, 12);
	// O aro (aperture) vai de REEL_RADIUS * 0.94 a REEL_RADIUS * 1.12, deixando folga radial para os chanfros
	const apertureGeometry = createRingGeometry(REEL_RADIUS * 1.12, REEL_RADIUS * 0.94, 0.008);
	const apertureMaterial = new MeshPhysicalMaterial({
		color: '#11100f',
		roughness: 0.46,
		metalness: 0.12,
		clearcoat: 0.32,
		clearcoatRoughness: 0.18,
	});
	// A cavidade é um cilindro de raio REEL_RADIUS * 0.9 e altura REEL_CAVITY_DEPTH
	const cavityGeometry = new CylinderGeometry(REEL_RADIUS * 0.9, REEL_RADIUS * 0.9, REEL_CAVITY_DEPTH, 32);
	const cavityMaterial = new MeshPhysicalMaterial({ color: '#080706', roughness: 0.7, metalness: 0.02 });
	const windowGeometry = new RoundedBoxGeometry(WINDOW_WIDTH, 0.006, WINDOW_DEPTH, 3, 0.003);
	const windowMaterial = new MeshPhysicalMaterial({
		color: '#090807',
		roughness: 0.28,
		metalness: 0.05,
		clearcoat: 0.7,
		clearcoatRoughness: 0.12,
	});
	const tapeStripGeometry = new RoundedBoxGeometry(WINDOW_WIDTH * 0.82, 0.004, 0.055, 2, 0.002);
	const tapeStripMaterial = new MeshPhysicalMaterial({ color: '#60432a', roughness: 0.58, metalness: 0.04 });
	// O vidro acrílico usa transmission: 0.9, ior: 1.49 e attenuationColor: '#eef5f2' com transparent: false e depthWrite: true para evitar problemas de ordenação de profundidade
	const glassGeometry = new RoundedBoxGeometry(WINDOW_WIDTH * 0.92, 0.006, WINDOW_DEPTH * 0.72, 3, 0.0025);
	const glassMaterial = new MeshPhysicalMaterial({
		color: '#ffffff',
		roughness: 0.015,
		metalness: 0,
		transmission: 0.9,
		thickness: 0.008,
		ior: 1.49,
		attenuationColor: '#eef5f2',
		attenuationDistance: 0.8,
		transparent: false,
		opacity: 1,
		depthWrite: true,
		clearcoat: 0.38,
		clearcoatRoughness: 0.025,
	});
	const cableSocketGeometry = new CylinderGeometry(0.083, 0.083, 0.016, 24);
	const cableSocketMaterial = new MeshPhysicalMaterial({
		color: '#070707',
		roughness: 0.38,
		metalness: 0.38,
		clearcoat: 0.24,
	});
	const cablePlugGeometry = new RoundedBoxGeometry(0.22, 0.19, 0.175, 3, 0.03);
	const cablePlugMaterial = new MeshPhysicalMaterial({
		color: '#efede7',
		roughness: 0.25,
		metalness: 0.02,
		clearcoat: 0.44,
		clearcoatRoughness: 0.16,
	});

	// Montagem de cada fita (albums.map)
	const spines = albums.map((album, index) => {
		// 1. Carcaça
		const geometry = new RoundedBoxGeometry(SPINE_WIDTH, SPINE_HEIGHT, SPINE_DEPTH, SHELL_SEGMENTS, SHELL_RADIUS);

		// 2. Mapas procedurais por álbum
		const plasticMaps = createSurfaceMaps(`${album.id || album.title}-${album.color || 'shell'}-plastic`);
		const paperMaps = createSurfaceMaps(`${album.id || album.title}-paper`, { paper: true });

		// 3. Materiais
		const reelMaterial = new MeshPhysicalMaterial({
			color: reelTint(album.color),
			roughness: 0.42,
			metalness: 0.2,
			clearcoat: 0.3,
			clearcoatRoughness: 0.2,
		});
		const sideMaterial = new MeshPhysicalMaterial({
			color: album.color || '#2a2622',
			roughness: 0.34,
			roughnessMap: plasticMaps.roughnessMap,
			normalMap: plasticMaps.normalMap,
			normalScale: new Vector2(0.045, 0.045),
			metalness: 0.02,
			clearcoat: 0.65,
			clearcoatRoughness: 0.18,
			reflectivity: 0.52,
			transparent: true,
		});
		const labelMaterial = new MeshPhysicalMaterial({
			map: drawLabel(album),
			roughness: 0.9,
			roughnessMap: paperMaps.roughnessMap,
			normalMap: paperMaps.normalMap,
			normalScale: new Vector2(0.055, 0.055),
			metalness: 0,
			clearcoat: 0.03,
			clearcoatRoughness: 0.9,
			transparent: true,
		});
		const faceMaterial = new MeshPhysicalMaterial({
			map: drawCassetteFace(album),
			roughness: 0.38,
			roughnessMap: plasticMaps.roughnessMap,
			normalMap: plasticMaps.normalMap,
			normalScale: new Vector2(0.035, 0.035),
			metalness: 0.015,
			clearcoat: 0.58,
			clearcoatRoughness: 0.16,
			transparent: true,
		});

		// 4. Ordem dos 6 materiais: [+x, -x, +y, -y, +z, -z]
		const materials = [sideMaterial, sideMaterial, faceMaterial, sideMaterial, labelMaterial, sideMaterial];
		const mesh = new Mesh(geometry, materials);
		mesh.userData.albumIndex = index;

		// 5. Peças filhas do mesh
		const windowMesh = new Mesh(windowGeometry, windowMaterial);
		windowMesh.position.set(0, SPINE_HEIGHT / 2 + 0.0005, REEL_OFFSET_Z);
		mesh.add(windowMesh);

		const tapeStrip = new Mesh(tapeStripGeometry, tapeStripMaterial);
		tapeStrip.position.set(0, REEL_Y + 0.0025, REEL_OFFSET_Z);
		mesh.add(tapeStrip);

		const glassMesh = new Mesh(glassGeometry, glassMaterial);
		glassMesh.position.set(0, REEL_Y + 0.009, REEL_OFFSET_Z);
		mesh.add(glassMesh);

		// 6. Os dois conjuntos de carretel
		const cavities = [];
		const apertures = [];
		const reelHolders = [];
		const reels = [-REEL_OFFSET_X, REEL_OFFSET_X].map((x) => {
			const cavity = new Mesh(cavityGeometry, cavityMaterial);
			cavity.position.set(x, REEL_Y - 0.003, REEL_OFFSET_Z);
			mesh.add(cavity);
			cavities.push(cavity);
			const aperture = new Mesh(apertureGeometry, apertureMaterial);
			const apertureHolder = new Group();
			apertureHolder.rotation.x = -Math.PI / 2;
			apertureHolder.position.set(x, REEL_Y + 0.002, REEL_OFFSET_Z);
			apertureHolder.add(aperture);
			mesh.add(apertureHolder);
			apertures.push(apertureHolder);
			const reelMesh = new Mesh(reelGeometry, reelMaterial);
			const reelHolder = new Group();
			reelHolder.rotation.x = -Math.PI / 2;
			reelHolder.position.set(x, REEL_Y + 0.003, REEL_OFFSET_Z);
			reelHolder.add(reelMesh);
			mesh.add(reelHolder);
			reelHolders.push(reelHolder);
			return reelMesh;
		});

		// 7. Grupo externo, socket, plugue e âncora do cabo
		const group = new Group();
		group.add(mesh);
		const cableSocket = new Mesh(cableSocketGeometry, cableSocketMaterial);
		cableSocket.rotation.z = Math.PI / 2;
		cableSocket.position.set(CABLE_OUTLET_X + 0.002, CABLE_OUTLET_Y, CABLE_OUTLET_Z);
		mesh.add(cableSocket);
		const cablePlug = new Mesh(cablePlugGeometry, cablePlugMaterial);
		cablePlug.position.set(CABLE_OUTLET_X + 0.108, CABLE_OUTLET_Y, CABLE_OUTLET_Z);
		mesh.add(cablePlug);
		const cableAnchor = new Group();
		cableAnchor.position.set(CABLE_OUTLET_X + 0.23, CABLE_OUTLET_Y, CABLE_OUTLET_Z);
		mesh.add(cableAnchor);

		// 8. Posicionamento e userData
		const baseY = isShelfLayout ? -0.35 + ((index % 3) - 1) * 0.025 : startY - index * (SPINE_HEIGHT + GAP);
		const baseX = isShelfLayout ? -shelfWidth / 2 + SPINE_HEIGHT / 2 + index * (SPINE_HEIGHT + shelfGap) : 0;
		group.position.set(baseX, baseY, 0);
		group.rotation.z = isShelfLayout ? Math.PI / 2 : 0;
		group.userData.baseX = baseX;
		group.userData.baseY = baseY;
		group.userData.albumIndex = index;
		group.userData.materials = [...materials];
		group.userData.reels = reels;
		group.userData.cableAnchor = cableAnchor;
		group.userData.detailParts = [windowMesh, tapeStrip, glassMesh, cableSocket, cablePlug, ...cavities, ...apertures, ...reelHolders, ...reels];
		group.userData.detailParts.forEach((part) => { part.visible = false; });
		group.userData.opacity = 1;
		scene.add(group);

		// 12. Carregamento assíncrono da capa
		const coverImage = new Image();
		coverImage.onload = () => {
			const nextMap = drawCassetteFace(album, coverImage);
			const nextLabelMap = drawLabel(album, coverImage);
			if (destroyed) {
				nextMap.dispose();
				nextLabelMap.dispose();
				return;
			}
			faceMaterial.map?.dispose();
			faceMaterial.map = nextMap;
			faceMaterial.needsUpdate = true;
			labelMaterial.map?.dispose();
			labelMaterial.map = nextLabelMap;
			labelMaterial.needsUpdate = true;
		};
		if (album.cover) coverImage.src = album.cover;

		return group;
	});

	// Raycasting e ponteiro
	function meshesFlat() {
		return spines.map((g) => g.children[0]); // o mesh do casco é o 1º filho do Group
	}

	function pointerFromEvent(event) {
		const rect = renderer.domElement.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	}

	function pick(event) {
		pointerFromEvent(event);
		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObjects(meshesFlat(), false);
		return hits.length ? hits[0].object.userData.albumIndex : -1;
	}

	function handleMove(event) {
		if (mode === 'detail') {
			if (isDragging) {
				const dx = event.clientX - dragStart.x;
				const dy = event.clientY - dragStart.y;
				dragRotation.y = Math.max(-0.85, Math.min(0.85, dx * 0.008));
				dragRotation.x = Math.max(-0.7, Math.min(0.7, -dy * 0.008));
				return;
			}
			const index = pick(event);
			renderer.domElement.style.cursor = index === focusIndex ? 'grab' : 'default';
			return;
		}
		const index = pick(event);
		hoveredIndex = index;
		renderer.domElement.style.cursor = index >= 0 ? 'pointer' : 'default';
	}

	function handleLeave() {
		if (isDragging) return;
		hoveredIndex = -1;
		renderer.domElement.style.cursor = 'default';
	}

	function handlePointerDown(event) {
		if (mode !== 'detail' || focusIndex < 0 || pick(event) !== focusIndex) return;
		isDragging = true;
		dragPointerId = event.pointerId;
		dragStart = { x: event.clientX, y: event.clientY };
		dragRotation = { x: 0, y: 0 };
		renderer.domElement.setPointerCapture?.(event.pointerId);
		renderer.domElement.style.cursor = 'grabbing';
		event.preventDefault();
	}

	function handlePointerUp(event) {
		if (!isDragging || (dragPointerId !== null && event.pointerId !== dragPointerId)) return;
		isDragging = false;
		dragPointerId = null;
		renderer.domElement.releasePointerCapture?.(event.pointerId);
		renderer.domElement.style.cursor = mode === 'detail' ? 'grab' : 'default';
	}

	function handleClick(event) {
		if (mode !== 'list') return;
		const index = pick(event);
		if (index >= 0) onSelect?.(index);
	}

	renderer.domElement.addEventListener('pointermove', handleMove);
	renderer.domElement.addEventListener('pointerleave', handleLeave);
	renderer.domElement.addEventListener('pointerdown', handlePointerDown);
	renderer.domElement.addEventListener('pointerup', handlePointerUp);
	renderer.domElement.addEventListener('pointercancel', handlePointerUp);
	renderer.domElement.addEventListener('click', handleClick);

	// Redimensionamento
	function resize() {
		const { clientWidth, clientHeight } = container;
		if (!clientWidth || !clientHeight) return;
		renderer.setSize(clientWidth, clientHeight, false);
		camera.aspect = clientWidth / clientHeight;
		camera.updateProjectionMatrix();
	}

	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(container);
	resize();

	// Laço de animação
	function animate() {
		const delta = Math.min(clock.getDelta(), 0.05);

		const camTarget = CAMERA[mode];
		const listY = startY - scrollProgress * scrollSpan;
		const targetY = mode === 'list' ? listY + (isShelfLayout ? 0 : LIST_CAMERA_OFFSET) : camTarget.position[1];
		camera.position.x += (camTarget.position[0] - camera.position.x) * 0.1;
		camera.position.y += (targetY - camera.position.y) * 0.12;
		camera.position.z += (camTarget.position[2] - camera.position.z) * 0.1;
		if (Math.abs(camera.fov - camTarget.fov) > 0.01) {
			camera.fov += (camTarget.fov - camera.fov) * 0.1;
			camera.updateProjectionMatrix();
		}
		const targetPitch = mode === 'list' && !isShelfLayout ? LIST_PITCH : 0;
		camera.rotation.x += (targetPitch - camera.rotation.x) * 0.12;

		spines.forEach((group) => {
			const index = group.userData.albumIndex;
			const isFocused = mode === 'detail' && index === focusIndex;
			const isHover = mode === 'list' && index === hoveredIndex;
			group.userData.detailParts.forEach((part) => { part.visible = isFocused; });

			let targetRotY = 0;
			let targetRotX = isHover ? -0.26 : 0;
			let targetRotZ = isShelfLayout ? Math.PI / 2 : 0;
			let targetZ = isHover ? 0.6 : 0;
			let targetY = group.userData.baseY;
			let targetX = group.userData.baseX || 0;
			let targetScale = 1;
			let targetOpacity = 1;

			if (mode === 'detail') {
				if (isFocused) {
					targetRotY = dragRotation.y;
					targetRotX = Math.PI / 2 + dragRotation.x;
					targetRotZ = 0;
					targetZ = 0.9;
					targetY = 0;
					targetX = 0;
					targetScale = 1.12;
					targetOpacity = 1;
				} else {
					targetRotX = 0;
					targetZ = -2.2;
					targetY = group.userData.baseY + (index < focusIndex ? 3.4 : -3.4);
					targetX = group.userData.baseX || 0;
					targetScale = 0.82;
					targetOpacity = 0;
				}
			}

			group.rotation.y += (targetRotY - group.rotation.y) * 0.12;
			group.rotation.x += (targetRotX - group.rotation.x) * 0.16;
			group.rotation.z += (targetRotZ - group.rotation.z) * 0.12;
			group.position.z += (targetZ - group.position.z) * 0.14;
			group.position.y += (targetY - group.position.y) * 0.14;
			group.position.x += (targetX - group.position.x) * 0.14;
			const nextScale = group.scale.x + (targetScale - group.scale.x) * 0.14;
			group.scale.setScalar(nextScale);
			group.userData.opacity += (targetOpacity - group.userData.opacity) * 0.14;
			group.userData.materials.forEach((mat) => { mat.opacity = group.userData.opacity; });

			if (index === playingIndex && isPlaying) {
				group.userData.reels.forEach((reel) => {
					reel.rotation.z -= REEL_SPIN_SPEED * delta * 60;
				});
			}
		});

		renderer.render(scene, camera);
	}

	renderer.setAnimationLoop(animate);

	// Retorno dos métodos públicos de contrato
	return {
		getFocusedCableAnchor() {
			if (mode !== 'detail' || focusIndex < 0) return null;
			const anchor = spines[focusIndex]?.userData.cableAnchor;
			if (!anchor) return null;
			const point = anchor.getWorldPosition(cableWorldPoint).project(camera);
			const rect = renderer.domElement.getBoundingClientRect();
			return {
				x: rect.left + (point.x + 1) * 0.5 * rect.width,
				y: rect.top + (1 - point.y) * 0.5 * rect.height,
			};
		},
		setScroll(progress) {
			scrollProgress = Math.min(Math.max(progress, 0), 1);
		},
		setPlayback(index, playing) {
			playingIndex = index;
			isPlaying = playing;
		},
		enter(index) {
			mode = 'detail';
			focusIndex = index;
			hoveredIndex = -1;
			isDragging = false;
			dragPointerId = null;
			dragRotation = { x: 0, y: 0 };
			renderer.domElement.style.cursor = 'grab';
		},
		exit() {
			mode = 'list';
			focusIndex = -1;
		},
		destroy() {
			destroyed = true;
			renderer.setAnimationLoop(null);
			resizeObserver.disconnect();
			renderer.domElement.removeEventListener('pointermove', handleMove);
			renderer.domElement.removeEventListener('pointerleave', handleLeave);
			renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
			renderer.domElement.removeEventListener('pointerup', handlePointerUp);
			renderer.domElement.removeEventListener('pointercancel', handlePointerUp);
			renderer.domElement.removeEventListener('click', handleClick);

			const geometries = new Set();
			const materials = new Set();
			const textures = new Set();
			scene.traverse((object) => {
				if (object.geometry && !geometries.has(object.geometry)) {
					object.geometry.dispose();
					geometries.add(object.geometry);
				}
				const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
				objectMaterials.forEach((material) => {
					if (!material || materials.has(material)) return;
					for (const key in material) {
						const value = material[key];
						if (value?.isTexture && !textures.has(value)) {
							value.dispose();
							textures.add(value);
						}
					}
					material.dispose();
					materials.add(material);
				});
			});
			renderer.dispose();
			renderer.forceContextLoss?.();
			container.removeChild(renderer.domElement);
		},
	};
}
