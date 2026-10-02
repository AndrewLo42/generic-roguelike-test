/** Keyboard + mouse state. Game code polls this each tick instead of reacting to events. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  rmb = false;
  /** Screen position of a left click this tick (for click-to-target). */
  leftClick: { x: number; y: number } | null = null;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.leftClick = { x: e.clientX, y: e.clientY };
      if (e.button === 2) {
        this.rmb = true;
        target.requestPointerLock?.();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this.rmb = false;
        if (document.pointerLockElement) document.exitPointerLock();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.rmb) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    target.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True only on the tick the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call once at the end of each logic tick. */
  endTick(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.leftClick = null;
  }
}
