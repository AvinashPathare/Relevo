"use client";
import { useParams } from "next/navigation";
import { LiveStatus } from "../../../components/LiveStatus.tsx";

export default function DraftBatchPage() {
  const { draftId } = useParams<{ draftId: string }>();
  return (
    <>
      <h1>Payout batch</h1>
      <LiveStatus draftId={draftId} />
    </>
  );
}
