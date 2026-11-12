"use client";
import { useParams } from "next/navigation";
import { LiveStatus } from "../../../components/LiveStatus.tsx";
import { Eyebrow } from "../../../components/ui.tsx";

export default function ChainBatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  return (
    <div className="sheet stack">
      <div>
        <Eyebrow>On-chain view · read-only</Eyebrow>
        <h1>Batch {batchId}</h1>
        <p className="lede">
          Read straight from the escrow contract. Payee names never go on-chain, so this view shows amounts,
          firms, penalties and the receipt hash only.
        </p>
      </div>
      <LiveStatus batchId={batchId} />
    </div>
  );
}
