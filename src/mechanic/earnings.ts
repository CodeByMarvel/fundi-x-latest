import { Job } from '../domain/jobs/types';
import { Cents } from '../domain/money';
import { commissionOn } from '../domain/payments/commission';

export type Earning = {
  job: Job;
  paidAt: string;
  /** What the customer paid. */
  gross: Cents;
  commission: Cents;
  /** What the provider keeps. */
  payout: Cents;
};

/** One line per paid job, newest first. */
export function earningsFrom(jobs: readonly Job[]): Earning[] {
  return jobs
    .filter(job => job.payment)
    .map(job => {
      const gross = job.payment!.amount;
      const commission = commissionOn(gross);
      return {
        job,
        paidAt: job.payment!.paidAt,
        gross,
        commission,
        payout: gross - commission,
      };
    })
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

export function sumPayouts(earnings: Earning[]): Cents {
  return earnings.reduce((sum, e) => sum + e.payout, 0);
}

export function isToday(iso: string, now = new Date()) {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
