import { Button, Chip, Eyebrow, Sticker, Ticket } from "../components/ui.tsx";

function finishedBatchHref(): string {
  try {
    const d = JSON.parse(process.env.ELIVO_DEPLOYMENT_JSON ?? "null") as { network?: string } | null;
    return d?.network === "testnet" ? "/chain/5" : "/firms";
  } catch {
    return "/firms";
  }
}

export default function Home() {
  return (
    <>
      <section className="sheet hero">
        <span className="pill-label">Testnet · NEAR · Sputnik DAO</span>
        <h1>Payouts a DAO can check.</h1>
        <p className="lede">
          A testnet prototype for paying a DAO's contributors in Mexico. The DAO votes once and the USDC locks
          in a NEAR escrow. Simulated payout firms with real testnet bonds deliver; a firm that misses its
          cut-off is rerouted and its bond pays a penalty to the DAO. Every batch ends in a signed receipt
          whose hash is anchored on-chain, so anyone can check what happened.
        </p>
        <div className="row">
          <Button href="/new">Start a batch →</Button>
          <Button href={finishedBatchHref()} variant="secondary">
            See a finished batch
          </Button>
        </div>

        <div className="hero-stickers">
          <Sticker tone="peach">
            <div className="row">
              <Chip tone="rose">MX-3</Chip>
              <span className="mono">missed its cut-off</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="mono">→ rerouted to</span>
              <Chip tone="mint">MX-2</Chip>
            </div>
            <div className="caption">Rerouted in seconds</div>
          </Sticker>
          <Sticker tone="lavender">
            <Eyebrow>Penalty · 1 bp per period</Eyebrow>
            <div className="ticket-value">
              <span>0.20</span>
              <small>USDC → DAO</small>
            </div>
            <div className="caption">Paid from the late firm's bond</div>
          </Sticker>
          <Sticker tone="paper">
            <div className="row">
              <Chip tone="paper">Account closed</Chip>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="mono">→ refunded in full</span>
              <Chip tone="mint">no penalty</Chip>
            </div>
            <div className="caption">Signed exclusion, not a failure</div>
          </Sticker>
          <Sticker tone="ink">
            <Eyebrow>Receipt hash on-chain</Eyebrow>
            <div className="mono" style={{ marginTop: 8, wordBreak: "break-all" }}>
              FLVmyFmHJurb5da3eT9de3to5Vw1…
            </div>
            <div className="caption">verify-receipt → OK</div>
          </Sticker>
        </div>
      </section>

      <div className="tickets">
        <Ticket
          tone="peach"
          label="Late penalty"
          value="1 bp"
          unit="per period"
          note="1 period = 1 hour (10 s in demo mode)"
        />
        <Ticket
          tone="paper"
          label="Penalty cap"
          value="2%"
          unit="of the payout"
          note="never more than the firm's bond"
        />
        <Ticket
          tone="lavender"
          label="Firm exposure"
          value="20×"
          unit="bond"
          note="open payouts per firm are capped"
        />
      </div>

      <section className="band tone-lavender">
        <Eyebrow>How it works</Eyebrow>
        <h2>One vote, four steps, one receipt.</h2>
        <ol className="steps-band">
          <Sticker as="li">
            <Eyebrow>01 · Upload</Eyebrow>
            <h3>Check the list first</h3>
            <p className="muted small">
              CSV of payees; every CLABE check digit is verified. Only a salted hash goes on-chain.
            </p>
          </Sticker>
          <Sticker as="li">
            <Eyebrow>02 · DAO vote</Eyebrow>
            <h3>Fund once</h3>
            <p className="muted small">
              A Sputnik DAO proposal; one council vote locks the USDC in the escrow, not with us.
            </p>
          </Sticker>
          <Sticker as="li">
            <Eyebrow>03 · Delivery</Eyebrow>
            <h3>Late means rerouted</h3>
            <p className="muted small">
              The cheapest bonded firm delivers. Miss the cut-off and the payout moves on.
            </p>
          </Sticker>
          <Sticker as="li">
            <Eyebrow>04 · Receipt</Eyebrow>
            <h3>Proof, not promises</h3>
            <p className="muted small">
              A signed receipt per batch; its hash is anchored and anyone can verify it.
            </p>
          </Sticker>
        </ol>
      </section>
    </>
  );
}
