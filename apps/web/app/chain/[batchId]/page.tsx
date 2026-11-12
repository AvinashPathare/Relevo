"use client";
import { useParams } from "next/navigation";
import { LiveStatus } from "../../../components/LiveStatus.tsx";

export default function ChainBatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  return (
    <>
      <h1>Batch {batchId}</h1>
      <p className="muted">
        Read straight from the escrow contract. Payee names never go on-chain, so this view shows amounts,
        firms, penalties and the receipt hash only.
      </p>
      <LiveStatus batchId={batchId} />
    </>
  );
}
