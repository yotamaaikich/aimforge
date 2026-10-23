export const DIFFICULTIES = {
  easy: { radius: 31, speed: 105, lifetime: 1800, multiplier: 0.8 },
  normal: { radius: 23, speed: 165, lifetime: 1200, multiplier: 1 },
  hard: { radius: 16, speed: 240, lifetime: 800, multiplier: 1.4 },
};

export class AimSession {
  constructor({ mode = 'flick', difficulty = 'normal', duration = 30, width = 800, height = 324, random = Math.random } = {}) {
    if (!['flick', 'tracking', 'reflex'].includes(mode) || !DIFFICULTIES[difficulty] || ![30, 60, 90].includes(duration)) throw new Error('Invalid session settings');
    Object.assign(this, { mode, difficulty, duration, width, height, random });
    this.config = DIFFICULTIES[difficulty];
    this.state = 'idle';
    this.pointer = { x: -1000, y: -1000, held: false };
    this.events = [];
    this.target = null;
  }
  start(now) {
    this.state = 'running';
    this.elapsed = 0; this.lastTime = now; this.score = 0; this.shots = 0; this.hits = 0;
    this.streak = 0; this.bestStreak = 0; this.reactions = []; this.trackedMs = 0; this.expired = 0;
    this.events = []; this.target = null; this.pointer.held = false;
    this.nextSpawn = this.mode === 'reflex' ? 650 + this.random() * 800 : 0;
    if (this.mode !== 'reflex') this.spawn();
  }
  spawn() {
    const margin = this.config.radius + 22;
    let x, y;
    for (let attempt = 0; attempt < 12; attempt++) {
      x = margin + this.random() * Math.max(0, this.width - 2 * margin);
      y = margin + this.random() * Math.max(0, this.height - 2 * margin);
      if (!this.target || Math.hypot(x - this.target.x, y - this.target.y) > Math.min(this.width * 0.23, 170)) break;
    }
    this.target = { x, y, radius: Math.min(this.config.radius, this.width / 8, this.height / 8), born: this.elapsed, vx: this.config.speed * (this.random() > 0.5 ? 1 : -1), vy: this.config.speed * .63 * (this.random() > 0.5 ? 1 : -1) };
  }
  step(now) {
    if (this.state !== 'running') return;
    const delta = Math.max(0, Math.min(now - this.lastTime, this.duration * 1000 - this.elapsed));
    this.lastTime = now;
    this.elapsed += delta;
    if (this.mode === 'tracking' && this.target) {
      // Small integration steps keep motion inside the arena even after a delayed frame.
      let remaining = delta;
      while (remaining > 0) {
        const dt = Math.min(remaining, 16); remaining -= dt;
        const t = this.target, margin = t.radius + 8;
        t.x += t.vx * dt / 1000; t.y += t.vy * dt / 1000;
        if (t.x < margin || t.x > this.width - margin) { t.vx *= -1; t.x = Math.max(margin, Math.min(this.width - margin, t.x)); }
        if (t.y < margin || t.y > this.height - margin) { t.vy *= -1; t.y = Math.max(margin, Math.min(this.height - margin, t.y)); }
        if (this.pointer.held && Math.hypot(this.pointer.x - t.x, this.pointer.y - t.y) <= t.radius) this.trackedMs += dt;
      }
      this.score = Math.round(this.trackedMs / 10 * this.config.multiplier);
    }
    if (this.elapsed >= this.duration * 1000) { this.elapsed = this.duration * 1000; this.state = 'finished'; this.pointer.held = false; return; }
    if (this.mode === 'reflex') {
      if (this.target && this.elapsed - this.target.born >= this.config.lifetime) {
        this.expired++; this.streak = 0;
        this.events.push({ type: 'expired', x: this.target.x, y: this.target.y });
        this.target = null; this.nextSpawn = this.elapsed + 500 + this.random() * 700;
      }
      if (!this.target && this.elapsed >= this.nextSpawn) this.spawn();
    }
  }
  shoot(x, y, now) {
    this.step(now);
    if (this.state !== 'running' || this.mode === 'tracking') return null;
    this.shots++;
    if (this.target && Math.hypot(x - this.target.x, y - this.target.y) <= this.target.radius) {
      const reaction = Math.max(0, this.elapsed - this.target.born);
      this.hits++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak); this.reactions.push(reaction);
      const points = Math.round((Math.max(35, 120 - reaction / 15) + Math.min(this.streak - 1, 10) * 5) * this.config.multiplier);
      this.score += points;
      const event = { type: 'hit', x: this.target.x, y: this.target.y, points, reaction };
      if (this.mode === 'flick') this.spawn();
      else { this.target = null; this.nextSpawn = this.elapsed + 500 + this.random() * 950; }
      return event;
    }
    this.streak = 0; this.score = Math.max(0, this.score - 25);
    return { type: 'miss', x, y };
  }
  pause(now) { if (this.state === 'running') { this.step(now); if (this.state === 'running') this.state = 'paused'; } this.pointer.held = false; }
  resume(now) { if (this.state === 'paused') { this.lastTime = now; this.state = 'running'; } }
  resize(width, height) {
    if (this.target) { this.target.x *= width / this.width; this.target.y *= height / this.height; }
    this.width = width; this.height = height;
  }
  get accuracy() { return this.mode === 'tracking' ? (this.elapsed ? this.trackedMs / this.elapsed * 100 : 0) : (this.shots ? this.hits / this.shots * 100 : 0); }
  get averageReaction() { return this.reactions.length ? Math.round(this.reactions.reduce((a, b) => a + b, 0) / this.reactions.length) : null; }
  result() {
    if (this.state !== 'finished') return null;
    return { mode: this.mode, difficulty: this.difficulty, duration: this.duration, score: this.score, accuracy: Math.round(this.accuracy * 10) / 10, reaction: this.averageReaction, hits: this.hits, shots: this.shots, streak: this.bestStreak, expired: this.expired, trackedMs: Math.round(this.trackedMs) };
  }
}
