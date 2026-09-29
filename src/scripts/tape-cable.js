const NODE_COUNT = 22;
const GRAVITY = 760;
const ITERATIONS = 7;
const CABLE_SLACK = 1.34;

function pointDistance(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestNode(points, point) {
	let closest = 1;
	let distance = Infinity;
	for (let index = 1; index < points.length - 1; index += 1) {
		const candidate = pointDistance(points[index], point);
		if (candidate < distance) {
			distance = candidate;
			closest = index;
		}
	}
	return { index: closest, distance };
}

export class TapeCable {
	constructor({ svg, getTapeAnchor, getPlayerAnchor }) {
		this.svg = svg;
		this.getTapeAnchor = getTapeAnchor;
		this.getPlayerAnchor = getPlayerAnchor;
		this.path = svg?.querySelector('.cable-main');
		this.shadow = svg?.querySelector('.cable-shadow');
		this.active = false;
		this.points = [];
		this.previous = [];
		this.pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false };
		this.grabIndex = null;
		this.lastTime = performance.now();
		this.frame = null;
		this.render = this.render.bind(this);
		this.handlePointerMove = this.handlePointerMove.bind(this);
		this.handlePointerDown = this.handlePointerDown.bind(this);
		this.handlePointerUp = this.handlePointerUp.bind(this);
		window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
		window.addEventListener('pointerdown', this.handlePointerDown, { passive: true });
		window.addEventListener('pointerup', this.handlePointerUp, { passive: true });
		window.addEventListener('pointercancel', this.handlePointerUp, { passive: true });
	}

	setActive(active) {
		this.active = Boolean(active);
		this.svg?.classList.toggle('is-active', this.active);
		if (this.active && this.frame === null) {
			this.lastTime = performance.now();
			this.frame = requestAnimationFrame(this.render);
		}
	}

	getAnchors() {
		const tape = this.getTapeAnchor?.();
		const player = this.getPlayerAnchor?.();
		return tape && player ? { tape, player } : null;
	}

	reset({ tape, player }) {
		this.points = Array.from({ length: NODE_COUNT }, (_, index) => {
			const progress = index / (NODE_COUNT - 1);
			return {
				x: tape.x + (player.x - tape.x) * progress,
				y: tape.y + (player.y - tape.y) * progress + Math.sin(Math.PI * progress) * 82,
			};
		});
		this.previous = this.points.map((point) => ({ ...point }));
	}

	handlePointerMove(event) {
		const next = { x: event.clientX, y: event.clientY };
		this.pointer.vx = next.x - this.pointer.x;
		this.pointer.vy = next.y - this.pointer.y;
		this.pointer.x = next.x;
		this.pointer.y = next.y;
		this.pointer.active = true;
	}

	handlePointerDown(event) {
		if (!this.active || this.points.length < 3) return;
		const hit = closestNode(this.points, event);
		if (hit.distance > 22) return;
		this.grabIndex = hit.index;
		this.pointer.x = event.clientX;
		this.pointer.y = event.clientY;
		this.pointer.vx = 0;
		this.pointer.vy = 0;
	}

	handlePointerUp() {
		this.grabIndex = null;
	}

	step(anchors, delta) {
		if (this.points.length !== NODE_COUNT) this.reset(anchors);

		const { tape, player } = anchors;
		const first = this.points[0];
		const last = this.points.at(-1);
		first.x = tape.x;
		first.y = tape.y;
		last.x = player.x;
		last.y = player.y;
		this.previous[0] = { ...first };
		this.previous[this.previous.length - 1] = { ...last };

		for (let index = 1; index < this.points.length - 1; index += 1) {
			const point = this.points[index];
			const prior = this.previous[index];
			const velocityX = (point.x - prior.x) * 0.985;
			const velocityY = (point.y - prior.y) * 0.985;
			prior.x = point.x;
			prior.y = point.y;
			point.x += velocityX;
			point.y += velocityY + GRAVITY * delta * delta;
			if (this.grabIndex === index) {
				point.x = this.pointer.x;
				point.y = this.pointer.y;
				prior.x = point.x - this.pointer.vx * 1.8;
				prior.y = point.y - this.pointer.vy * 1.8;
			} else if (this.pointer.active) {
				const distance = pointDistance(point, this.pointer);
				if (distance < 105) {
					const pull = (1 - distance / 105) * 0.12;
					point.x += this.pointer.vx * pull;
					point.y += this.pointer.vy * pull;
				}
			}
		}

		const directDistance = pointDistance(tape, player);
		const segmentLength = Math.max(13, (directDistance * CABLE_SLACK) / (NODE_COUNT - 1));
		for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
			this.points[0].x = tape.x;
			this.points[0].y = tape.y;
			this.points.at(-1).x = player.x;
			this.points.at(-1).y = player.y;
			for (let index = 0; index < this.points.length - 1; index += 1) {
				const a = this.points[index];
				const b = this.points[index + 1];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const distance = Math.max(Math.hypot(dx, dy), 0.001);
				const correction = ((distance - segmentLength) / distance) * 0.5;
				const offsetX = dx * correction;
				const offsetY = dy * correction;
				if (index !== 0) {
					a.x += offsetX;
					a.y += offsetY;
				}
				if (index + 1 !== this.points.length - 1) {
					b.x -= offsetX;
					b.y -= offsetY;
				}
			}
		}
	}

	draw() {
		if (!this.path || this.points.length < 2) return;
		let d = `M ${this.points[0].x.toFixed(1)} ${this.points[0].y.toFixed(1)}`;
		for (let index = 1; index < this.points.length - 1; index += 1) {
			const point = this.points[index];
			const next = this.points[index + 1];
			const midpointX = (point.x + next.x) * 0.5;
			const midpointY = (point.y + next.y) * 0.5;
			d += ` Q ${point.x.toFixed(1)} ${point.y.toFixed(1)} ${midpointX.toFixed(1)} ${midpointY.toFixed(1)}`;
		}
		const end = this.points.at(-1);
		d += ` T ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
		this.path.setAttribute('d', d);
		this.shadow?.setAttribute('d', d);
	}

	render(now) {
		this.frame = null;
		if (!this.active) return;
		const anchors = this.getAnchors();
		if (anchors) {
			this.step(anchors, Math.min(0.028, (now - this.lastTime) / 1000));
			this.draw();
		}
		this.pointer.vx *= 0.83;
		this.pointer.vy *= 0.83;
		this.lastTime = now;
		this.frame = requestAnimationFrame(this.render);
	}

	destroy() {
		if (this.frame !== null) cancelAnimationFrame(this.frame);
		window.removeEventListener('pointermove', this.handlePointerMove);
		window.removeEventListener('pointerdown', this.handlePointerDown);
		window.removeEventListener('pointerup', this.handlePointerUp);
		window.removeEventListener('pointercancel', this.handlePointerUp);
	}
}
