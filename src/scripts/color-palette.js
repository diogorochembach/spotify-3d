import { Color } from 'three';

const DEFAULT_PALETTE = { top: '#ff6b3d', bottom: '#3366ff', accent: '#f4b45d' };

function colorDistance(a, b) {
	return Math.sqrt(((a.r - b.r) ** 2) + ((a.g - b.g) ** 2) + ((a.b - b.b) ** 2));
}

/** Extract a contrast-friendly palette from the active cassette cover. */
export function extractCoverPalette(src, fallback = {}) {
	const fallbackPalette = { ...DEFAULT_PALETTE, ...fallback };
	if (!src) return Promise.resolve(fallbackPalette);
	return new Promise((resolve) => {
		const image = new Image();
		image.decoding = 'async';
		image.onload = () => {
			try {
				const size = 48;
				const canvas = document.createElement('canvas');
				canvas.width = size;
				canvas.height = size;
				const context = canvas.getContext('2d', { willReadFrequently: true });
				if (!context) throw new Error('Canvas de paleta indisponível');
				context.drawImage(image, 0, 0, size, size);
				const pixels = context.getImageData(0, 0, size, size).data;
				const buckets = new Map();
				for (let index = 0; index < pixels.length; index += 4) {
					if (pixels[index + 3] < 128) continue;
					const red = Math.min(255, Math.round(pixels[index] / 24) * 24);
					const green = Math.min(255, Math.round(pixels[index + 1] / 24) * 24);
					const blue = Math.min(255, Math.round(pixels[index + 2] / 24) * 24);
					const color = new Color(`rgb(${red}, ${green}, ${blue})`);
					const max = Math.max(red, green, blue);
					const min = Math.min(red, green, blue);
					const saturation = max ? (max - min) / max : 0;
					const key = `${red},${green},${blue}`;
					const bucket = buckets.get(key) || { color, count: 0, saturation };
					bucket.count += 1;
					buckets.set(key, bucket);
				}
				const ranked = [...buckets.values()].sort((a, b) => {
					const scoreA = a.count * (0.7 + a.saturation * 1.1);
					const scoreB = b.count * (0.7 + b.saturation * 1.1);
					return scoreB - scoreA;
				});
				const selected = [];
				for (const candidate of ranked) {
					if (selected.every((item) => colorDistance(item.color, candidate.color) > 0.16)) selected.push(candidate);
					if (selected.length === 4) break;
				}
				if (!selected.length) throw new Error('Paleta vazia');
				const byLightness = [...selected].sort((a, b) => a.color.getHSL({}).l - b.color.getHSL({}).l);
				const darkest = byLightness[0].color;
				const brightest = byLightness.at(-1).color;
				const accent = selected.find((item) => item.saturation > 0.26)?.color || brightest;
				resolve({ top: `#${brightest.getHexString()}`, bottom: `#${darkest.getHexString()}`, accent: `#${accent.getHexString()}` });
			} catch {
				resolve(fallbackPalette);
			}
		};
		image.onerror = () => resolve(fallbackPalette);
		image.src = src;
	});
}
