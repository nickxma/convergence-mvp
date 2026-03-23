import type { Metadata } from 'next';
import { BillingClient } from './billing-client';

export const metadata: Metadata = {
  title: 'Billing — Convergence',
  description: 'Manage your subscription, view payment history, and cancel.',
};

export default function BillingPage() {
  return <BillingClient />;
}
