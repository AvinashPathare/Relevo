export default function Home() {
  return (
    <>
      <h1>A testnet prototype for paying a DAO's contributors in Mexico</h1>
      <p>
        The DAO votes once and the USDC locks in a NEAR escrow. Simulated payout firms with real testnet bonds
        deliver; a firm that misses its cut-off is rerouted and its bond pays a penalty to the DAO. Every
        batch ends in a signed receipt whose hash is anchored on-chain, so anyone can check what happened.
      </p>
      <ul>
        <li>
          <a href="/new">Start a batch</a>: upload a CSV, check it, see the quote, then propose it to the DAO.
        </li>
        <li>
          <a href="/firms">Firms</a>: bonds and on-time record, read from the escrow contract.
        </li>
        <li>
          Any funded batch: <code>/chain/&lt;batch id&gt;</code> shows its state straight from the contract.
        </li>
      </ul>
    </>
  );
}
