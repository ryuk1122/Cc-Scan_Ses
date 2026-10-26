/** Reject callbacks from a camera session that was paused, replaced or sent to the background. */
export class ScannerSession {
  id = 0;
  private active = false;
  setActive(active: boolean) {
    if (active !== this.active) { this.active = active; this.id++; }
  }
  accepts(id: number) { return this.active && Number.isInteger(id) && id === this.id; }
}
