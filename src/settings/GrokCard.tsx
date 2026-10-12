// The Grok card once the Grok CLI is on the PC. Its three ways in (the CLI's own login, a device
// code, a pasted xAI key; ACCT-008) are T-092-b.
import { taglineOf } from "./ConnectGrid";

export default function GrokCard() {
  return (
    <section className="conn-card" aria-label="Grok" data-state="disconnected">
      <header className="conn-head">
        <span className="conn-name">Grok</span>
        <span className="conn-chip disconnected">Not connected</span>
      </header>
      <p className="conn-detail conn-tagline">{taglineOf("grok")}</p>
      <div className="conn-headline">Grok is installed</div>
      <p className="conn-detail">Sign in by running Grok in a terminal; connecting from this card comes next.</p>
    </section>
  );
}
