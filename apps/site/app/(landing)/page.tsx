import release from "../../generated/release.json";
import styles from "./landing.module.css";

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
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav aria-label="Main" className={styles.nav}>
          <div className={styles.brand}>Tranquilo</div>
          <div className={styles.links}>
            <a href={release.docsUrl}>Docs</a>
            <a href={release.releaseNotesUrl}>Release notes</a>
            <a href="/install.sh">Install script</a>
          </div>
        </nav>

        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>CLI + MCP for Pronto House Help</p>
            <h1 className={styles.headline}>
              Find and book House Help slots from your terminal or agent.
            </h1>
            <p className={styles.lede}>
              Tranquilo installs a local CLI and MCP server for authenticated
              Pronto booking flows, including address-aware slot search,
              notify-only watches, and local QR payment.
            </p>
          </div>

          <aside aria-label="Install Tranquilo" className={styles.install}>
            <h2 className={styles.installTitle}>Install latest</h2>
            <p className={styles.installCopy}>
              This command installs Tranquilo {release.version} for your
              platform and configures supported local AI integrations.
            </p>
            <code className={styles.command}>{release.installCommand}</code>
            <div className={styles.facts}>
              <div className={styles.fact}>
                <span className={styles.factLabel}>Latest</span>
                <strong>v{release.version}</strong>
              </div>
              <div className={styles.fact}>
                <span className={styles.factLabel}>Released</span>
                <strong>{releaseDate()}</strong>
              </div>
              <div className={styles.fact}>
                <span className={styles.factLabel}>Docs</span>
                <a href={release.docsUrl}>Open docs</a>
              </div>
            </div>
          </aside>
        </section>

        <section aria-label="Capabilities" className={styles.sections}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>For humans</h2>
            <p className={styles.sectionCopy}>
              Search for maid slots with flexible dates, after-work windows,
              saved addresses, and a QR-first local payment flow.
            </p>
          </div>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>For agents</h2>
            <p className={styles.sectionCopy}>
              MCP tools expose structured auth, address, slot, watch, booking,
              and payment handoff flows with explicit safety boundaries.
            </p>
          </div>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>For releases</h2>
            <p className={styles.sectionCopy}>
              Every CLI release ships binaries, checksums, static docs, install
              metadata, and versioned references together.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
