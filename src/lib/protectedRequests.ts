// One instance per protected view. Tickets are bound to a lifecycle/auth epoch,
// rather than to the most recently started poll (which can starve slow replies).
export interface ProtectedTicket { epoch: number; sequence: number; controller: AbortController }
export class ProtectedRequests {
  private epoch = 0;
  private sequence = 0;
  private settled = 0;
  private active = false;
  private pending = new Set<ProtectedTicket>();
  activate() { this.invalidate(); this.active = true; }
  close() { this.active = false; this.invalidate(); }
  private invalidate() {
    this.epoch++; this.settled = 0;
    for (const ticket of this.pending) ticket.controller.abort();
    this.pending.clear();
  }
  begin(): ProtectedTicket | null {
    if (!this.active) return null;
    const ticket = { epoch: this.epoch, sequence: ++this.sequence, controller: new AbortController() };
    this.pending.add(ticket); return ticket;
  }
  current(ticket: ProtectedTicket) { return this.active && ticket.epoch === this.epoch; }
  accept(ticket: ProtectedTicket) {
    if (!this.current(ticket) || ticket.sequence < this.settled) return false;
    this.settled = ticket.sequence; return true;
  }
  deny(ticket: ProtectedTicket) {
    // An explicit denial must clear this epoch even if another poll has started.
    if (!this.current(ticket)) return false;
    this.invalidate(); return true;
  }
  finish(ticket: ProtectedTicket) { this.pending.delete(ticket); }
}
