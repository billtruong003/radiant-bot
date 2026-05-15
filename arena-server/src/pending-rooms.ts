/**
 * Atomic room counter for capacity cap.
 *
 * Single Node process, no worker threads → integer is the synchronization
 * primitive. `tryAcquire` is the gate: if it returns false, the admin
 * handler responds 503 ROOM_LIMIT_REACHED. DuelRoom.onDispose calls
 * release() so the slot frees deterministically even if the room
 * disposes via timeout / error.
 */

let active = 0;

export const roomCounter = {
  tryAcquire(max: number): boolean {
    if (active >= max) return false;
    active++;
    return true;
  },
  release(): void {
    if (active > 0) active--;
  },
  count(): number {
    return active;
  },
  /** Test-only reset. Never call in production. */
  __reset(): void {
    active = 0;
  },
};
