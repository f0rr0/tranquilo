import release from "../generated/release.json";

function releaseDate(): string {
  if (!release.releasedAt) {
    return "Local build";
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(release.releasedAt));
}

export default function Page() {
  return (
    <main className="page">
      <div className="shell">
        <nav aria-label="Main" className="nav">
          <div className="brand">Tranquilo</div>
          <div className="links">
            <a href="/docs/latest">Docs</a>
            <a href={release.releaseNotesUrl}>Release notes</a>
            <a href="/install.sh">Install script</a>
          </div>
        </nav>

        <section className="hero">
          <div>
            <p className="eyebrow">CLI + MCP for Pronto House Help</p>
            <h1>Find and book House Help slots from your terminal or agent.</h1>
            <p className="lede">
              Tranquilo installs a local CLI and MCP server for authenticated
              Pronto booking flows, including address-aware slot search,
              notify-only watches, and local QR payment.
            </p>
          </div>

          <aside aria-label="Install Tranquilo" className="install">
            <h2>Install latest</h2>
            <p>
              This command installs Tranquilo {release.version} for your
              platform and configures supported local AI integrations.
            </p>
            <code className="command">{release.installCommand}</code>
            <div className="facts">
              <div className="fact">
                <span>Latest</span>
                <strong>v{release.version}</strong>
              </div>
              <div className="fact">
                <span>Released</span>
                <strong>{releaseDate()}</strong>
              </div>
              <div className="fact">
                <span>Docs</span>
                <a href={release.docsUrl}>Open docs</a>
              </div>
            </div>
          </aside>
        </section>

        <section aria-label="Capabilities" className="sections">
          <div className="section">
            <h2>For humans</h2>
            <p>
              Search for maid slots with flexible dates, after-work windows,
              saved addresses, and a QR-first local payment flow.
            </p>
          </div>
          <div className="section">
            <h2>For agents</h2>
            <p>
              MCP tools expose structured auth, address, slot, watch, booking,
              and payment handoff flows with explicit safety boundaries.
            </p>
          </div>
          <div className="section">
            <h2>For releases</h2>
            <p>
              Every CLI release ships binaries, checksums, static docs, install
              metadata, and versioned references together.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
