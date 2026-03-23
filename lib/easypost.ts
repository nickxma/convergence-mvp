/**
 * easypost.ts
 *
 * Thin wrapper around the EasyPost REST API for OpenClaw prize shipping.
 *
 * Auth: EASYPOST_API_KEY env var (test key: EZTKxxx, production: EZAKxxx).
 *
 * Implemented actions:
 *   createAndBuyShipment — create a shipment, pick the cheapest rate, buy postage
 *
 * EasyPost docs: https://www.easypost.com/docs/api
 */

const EASYPOST_API = 'https://api.easypost.com/v2';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string; // ISO-3166 alpha-2; defaults to 'US'
  phone?: string;
}

export interface ParcelDimensions {
  /** Weight in ounces */
  weightOz: number;
  /** Length in inches (optional — used for dimensional weight) */
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
}

export interface BoughtShipment {
  easypostShipmentId: string;
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string;
  carrier: string;
  service: string;
  /** Postage cost in USD cents */
  rateCents: number;
}

interface EasyPostAddress {
  id: string;
  name: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  verifications?: { delivery?: { success: boolean; errors: unknown[] } };
}

interface EasyPostRate {
  id: string;
  carrier: string;
  service: string;
  rate: string; // decimal string, e.g. "4.75"
  delivery_days?: number | null;
}

interface EasyPostShipment {
  id: string;
  rates: EasyPostRate[];
  postage_label?: { label_url: string };
  tracking_code?: string;
  tracker?: { public_url?: string };
  selected_rate?: EasyPostRate;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function easypostAuth(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

async function easypostRequest<T>(
  method: string,
  path: string,
  body: unknown,
  apiKey: string,
): Promise<T> {
  const res = await fetch(`${EASYPOST_API}${path}`, {
    method,
    headers: {
      Authorization: easypostAuth(apiKey),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const msg = (err as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(`EasyPost ${res.status}: ${msg}`);
  }

  return res.json() as Promise<T>;
}

/** FROM address: configurable via EASYPOST_FROM_* env vars. */
function buildFromAddress() {
  return {
    name: process.env.EASYPOST_FROM_NAME ?? 'OpenClaw Prizes',
    street1: process.env.EASYPOST_FROM_STREET ?? '123 Main St',
    city: process.env.EASYPOST_FROM_CITY ?? 'Austin',
    state: process.env.EASYPOST_FROM_STATE ?? 'TX',
    zip: process.env.EASYPOST_FROM_ZIP ?? '78701',
    country: process.env.EASYPOST_FROM_COUNTRY ?? 'US',
  };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Create an EasyPost shipment, verify the to-address, pick the cheapest rate,
 * and buy the postage label in one call.
 *
 * @throws if address verification fails or rate purchase fails.
 */
export async function createAndBuyShipment(
  toAddress: ShippingAddress,
  parcel: ParcelDimensions,
  apiKey: string,
): Promise<BoughtShipment> {
  // Validate + create address
  const addressPayload: Record<string, unknown> = {
    address: {
      name: toAddress.name,
      street1: toAddress.street1,
      street2: toAddress.street2 ?? null,
      city: toAddress.city,
      state: toAddress.state,
      zip: toAddress.zip,
      country: toAddress.country ?? 'US',
      phone: toAddress.phone ?? null,
      verify: ['delivery'],
    },
  };

  const verifiedAddress = await easypostRequest<EasyPostAddress>(
    'POST',
    '/addresses',
    addressPayload,
    apiKey,
  );

  // Warn on soft address issues but don't block
  if (verifiedAddress.verifications?.delivery?.success === false) {
    console.warn(
      `[easypost] address_verify_failed addr_id=${verifiedAddress.id} ` +
        `errors=${JSON.stringify(verifiedAddress.verifications.delivery.errors)}`,
    );
  }

  // Build parcel object
  const parcelPayload: Record<string, unknown> = {
    weight: parcel.weightOz,
  };
  if (parcel.lengthIn) parcelPayload.length = parcel.lengthIn;
  if (parcel.widthIn) parcelPayload.width = parcel.widthIn;
  if (parcel.heightIn) parcelPayload.height = parcel.heightIn;

  // Create shipment
  const shipment = await easypostRequest<EasyPostShipment>(
    'POST',
    '/shipments',
    {
      shipment: {
        to_address: { id: verifiedAddress.id },
        from_address: buildFromAddress(),
        parcel: parcelPayload,
      },
    },
    apiKey,
  );

  if (!shipment.rates || shipment.rates.length === 0) {
    throw new Error(`No shipping rates returned for shipment ${shipment.id}`);
  }

  // Pick cheapest rate
  const cheapestRate = shipment.rates.reduce<EasyPostRate>((best, r) => {
    return parseFloat(r.rate) < parseFloat(best.rate) ? r : best;
  }, shipment.rates[0]);

  // Buy postage
  const bought = await easypostRequest<EasyPostShipment>(
    'POST',
    `/shipments/${shipment.id}/buy`,
    { rate: { id: cheapestRate.id } },
    apiKey,
  );

  const trackingNumber = bought.tracking_code ?? '';
  const trackingUrl =
    bought.tracker?.public_url ??
    `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  const labelUrl = bought.postage_label?.label_url ?? '';
  const selectedRate = bought.selected_rate ?? cheapestRate;

  return {
    easypostShipmentId: bought.id,
    trackingNumber,
    trackingUrl,
    labelUrl,
    carrier: selectedRate.carrier,
    service: selectedRate.service,
    rateCents: Math.round(parseFloat(selectedRate.rate) * 100),
  };
}
