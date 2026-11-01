'use client';

/** Client wrapper so the public answer page can reuse the answer card. */
import { AnswerCard, type Turn } from '@/components/portal/AnswerCard';

export function SharedCard({ turn, stationName }: { turn: Turn; stationName?: string }) {
  return <AnswerCard turn={turn} stationName={stationName} onFollowUp={() => {}} onFocusFact={() => {}} shared />;
}
